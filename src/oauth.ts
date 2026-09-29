import crypto from "crypto";
import type { Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export const AUTH_CODE_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_BYTES = 32;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  info TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT,
  expires_at INTEGER NOT NULL
);`;

/** Creates the auth schema if missing; this is the whole migration story. */
export function initAuthSchema(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

const sha256Hex = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const randomToken = () => crypto.randomBytes(TOKEN_BYTES).toString("base64url");

/** Constant-time string comparison (hashes first so lengths match). */
function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(
    crypto.createHash("sha256").update(a).digest(),
    crypto.createHash("sha256").update(b).digest(),
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

// Hidden fields of the login form that must be echoed back to /authorize
const FORM_FIELDS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

type Row = Record<string, any>;

/**
 * Single-user OAuth 2.1 authorization server backed by SQLite. The SDK's
 * mcpAuthRouter handles HTTP details; this class holds clients, codes and
 * tokens (stored as sha256 hashes) and renders the password form.
 */
export class SingleUserOAuthProvider implements OAuthServerProvider {
  // PKCE is verified here, atomically with consuming the code
  skipLocalPkceValidation = true;

  constructor(
    private db: DatabaseSync,
    private password: string,
    private now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => {
        const row = this.db
          .prepare("SELECT info FROM clients WHERE client_id = ?")
          .get(clientId) as Row | undefined;
        return row ? JSON.parse(row.info) : undefined;
      },
      registerClient: (client) => {
        const full = {
          ...client,
          client_id: crypto.randomUUID(),
          client_id_issued_at: this.now(),
        } as OAuthClientInformationFull;
        this.db
          .prepare("INSERT INTO clients (client_id, info) VALUES (?, ?)")
          .run(full.client_id, JSON.stringify(full));
        return full;
      },
    };
  }

  /**
   * GET renders the password form; POST checks the password and redirects to
   * the client's (already validated) redirect URI with a fresh code.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const req = res.req;
    if (req.method !== "POST") {
      this.renderForm(res, req.query as Record<string, string>, false);
      return;
    }

    const password = String(req.body?.password ?? "");
    if (!safeEqual(password, this.password)) {
      this.renderForm(res, req.body, true);
      return;
    }

    const code = randomToken();
    this.db
      .prepare(
        `INSERT INTO auth_codes
         (code_hash, client_id, code_challenge, redirect_uri, scopes, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sha256Hex(code),
        client.client_id,
        params.codeChallenge,
        params.redirectUri,
        JSON.stringify(params.scopes ?? []),
        params.resource?.href ?? null,
        this.now() + AUTH_CODE_TTL_SECONDS,
      );

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    res.redirect(302, target.href);
  }

  private renderForm(
    res: Response,
    fields: Record<string, string>,
    failed: boolean,
  ): void {
    const hidden = FORM_FIELDS
      .filter((name) => fields[name] !== undefined)
      .map((name) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(String(fields[name]))}">`
      )
      .join("\n");
    res
      .status(failed ? 401 : 200)
      .setHeader("X-Frame-Options", "DENY")
      .setHeader("Content-Security-Policy", "frame-ancestors 'none'")
      .type("html")
      .send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title></head>
<body style="font-family: sans-serif; max-width: 20rem; margin: 4rem auto;">
<form method="post" action="/authorize">
<h1>Sign in</h1>
${failed ? '<p style="color: #b00020">Wrong password.</p>' : ""}
${hidden}
<input type="password" name="password" placeholder="Password" autofocus required style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
<button type="submit" style="margin-top: 1rem; padding: 0.5rem 1rem;">Continue</button>
</form></body></html>`);
  }

  // Unused because skipLocalPkceValidation is true, but required by the interface.
  async challengeForAuthorizationCode(): Promise<string> {
    throw new Error("PKCE is validated in exchangeAuthorizationCode");
  }

  /** Consumes the code (single use, even on failure) and issues an access/refresh pair. */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const row = this.db
      .prepare("DELETE FROM auth_codes WHERE code_hash = ? RETURNING *")
      .get(sha256Hex(authorizationCode)) as Row | undefined;

    if (!row || row.client_id !== client.client_id || row.expires_at <= this.now()) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (!codeVerifier) {
      throw new InvalidRequestError("code_verifier is required");
    }
    const challenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    if (!safeEqual(challenge, row.code_challenge)) {
      throw new InvalidGrantError("code_verifier does not match the challenge");
    }

    return this.issueTokens(
      client.client_id,
      JSON.parse(row.scopes),
      row.resource ?? undefined,
    );
  }

  /** Rotates: the presented refresh token is consumed and a new pair is issued. */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const row = this.db
      .prepare(
        "DELETE FROM tokens WHERE token_hash = ? AND kind = 'refresh' RETURNING *",
      )
      .get(sha256Hex(refreshToken)) as Row | undefined;

    if (!row || row.client_id !== client.client_id || row.expires_at <= this.now()) {
      throw new InvalidGrantError("Invalid or expired refresh token");
    }
    const granted: string[] = JSON.parse(row.scopes);
    if (scopes && !scopes.every((s) => granted.includes(s))) {
      throw new InvalidGrantError("Requested scope exceeds the original grant");
    }

    return this.issueTokens(
      client.client_id,
      scopes ?? granted,
      row.resource ?? undefined,
    );
  }

  private issueTokens(
    clientId: string,
    scopes: string[],
    resource?: string,
  ): OAuthTokens {
    const now = this.now();
    this.db.prepare("DELETE FROM tokens WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM auth_codes WHERE expires_at <= ?").run(now);

    const insert = this.db.prepare(
      `INSERT INTO tokens (token_hash, kind, client_id, scopes, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const access = randomToken();
    const refresh = randomToken();
    const scopesJson = JSON.stringify(scopes);
    insert.run(sha256Hex(access), "access", clientId, scopesJson, resource ?? null, now + ACCESS_TOKEN_TTL_SECONDS);
    insert.run(sha256Hex(refresh), "refresh", clientId, scopesJson, resource ?? null, now + REFRESH_TOKEN_TTL_SECONDS);

    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refresh,
      scope: scopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db
      .prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'access'")
      .get(sha256Hex(token)) as Row | undefined;
    if (!row || row.expires_at <= this.now()) {
      throw new InvalidTokenError("Invalid or expired access token");
    }
    return {
      token,
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes),
      expiresAt: row.expires_at,
      resource: row.resource ? new URL(row.resource) : undefined,
    };
  }

  /** Revokes an access or refresh token; unknown tokens are ignored. */
  async revokeToken(
    client: OAuthClientInformationFull,
    request: { token: string },
  ): Promise<void> {
    this.db
      .prepare("DELETE FROM tokens WHERE token_hash = ? AND client_id = ?")
      .run(sha256Hex(request.token), client.client_id);
  }
}
