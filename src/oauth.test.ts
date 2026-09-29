import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  initAuthSchema,
  SingleUserOAuthProvider,
} from "./oauth.js";

const PASSWORD = "hunter2";
const REDIRECT_URI = "https://claude.ai/callback";
const VERIFIER = "v".repeat(64);
const CHALLENGE = crypto.createHash("sha256").update(VERIFIER).digest("base64url");

/** Provider on an in-memory DB with a controllable clock and one registered client. */
async function setup() {
  const clock = { now: 1_000_000 };
  const db = new DatabaseSync(":memory:");
  initAuthSchema(db);
  const provider = new SingleUserOAuthProvider(db, PASSWORD, () => clock.now);
  const client = (await provider.clientsStore.registerClient!({
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
  })) as OAuthClientInformationFull;
  return { clock, provider, client };
}

/** Fake express response capturing what authorize() sends. */
function fakeRes(method: string, body: Record<string, string> = {}) {
  const out: { status?: number; redirect?: string; html?: string } = {};
  const res: any = {
    req: { method, body, query: body },
    status(code: number) { out.status = code; return res; },
    setHeader() { return res; },
    type() { return res; },
    send(html: string) { out.html = html; return res; },
    redirect(_code: number, url: string) { out.redirect = url; },
  };
  return { res, out };
}

/** Runs the login POST and returns the issued code. */
async function login(provider: SingleUserOAuthProvider, client: OAuthClientInformationFull) {
  const { res, out } = fakeRes("POST", { password: PASSWORD });
  await provider.authorize(
    client,
    { redirectUri: REDIRECT_URI, codeChallenge: CHALLENGE, state: "s1", scopes: [] },
    res,
  );
  const url = new URL(out.redirect!);
  assert.equal(url.searchParams.get("state"), "s1");
  return url.searchParams.get("code")!;
}

test("PKCE-verified code exchange succeeds once", async () => {
  const { provider, client } = await setup();
  const code = await login(provider, client);

  const tokens = await provider.exchangeAuthorizationCode(client, code, VERIFIER, REDIRECT_URI);
  assert.equal(tokens.expires_in, ACCESS_TOKEN_TTL_SECONDS);
  const info = await provider.verifyAccessToken(tokens.access_token);
  assert.equal(info.clientId, client.client_id);

  // Reuse fails, even with the right verifier
  await assert.rejects(provider.exchangeAuthorizationCode(client, code, VERIFIER, REDIRECT_URI));
});

test("wrong PKCE verifier fails and burns the code", async () => {
  const { provider, client } = await setup();
  const code = await login(provider, client);

  await assert.rejects(provider.exchangeAuthorizationCode(client, code, "x".repeat(64), REDIRECT_URI));
  await assert.rejects(provider.exchangeAuthorizationCode(client, code, VERIFIER, REDIRECT_URI));
});

test("expired code fails", async () => {
  const { provider, client, clock } = await setup();
  const code = await login(provider, client);

  clock.now += AUTH_CODE_TTL_SECONDS + 1;
  await assert.rejects(provider.exchangeAuthorizationCode(client, code, VERIFIER, REDIRECT_URI));
});

test("wrong password re-renders the form and issues no code", async () => {
  const { provider, client } = await setup();
  const { res, out } = fakeRes("POST", { password: "nope", client_id: client.client_id });
  await provider.authorize(
    client,
    { redirectUri: REDIRECT_URI, codeChallenge: CHALLENGE, scopes: [] },
    res,
  );
  assert.equal(out.status, 401);
  assert.equal(out.redirect, undefined);
  assert.match(out.html!, /Wrong password/);
});

test("refresh rotation issues a new pair and consumes the old refresh token", async () => {
  const { provider, client, clock } = await setup();
  const code = await login(provider, client);
  const first = await provider.exchangeAuthorizationCode(client, code, VERIFIER, REDIRECT_URI);

  // Works after the access token has expired
  clock.now += ACCESS_TOKEN_TTL_SECONDS + 1;
  await assert.rejects(provider.verifyAccessToken(first.access_token));
  const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
  assert.notEqual(second.refresh_token, first.refresh_token);
  await provider.verifyAccessToken(second.access_token);

  await assert.rejects(provider.exchangeRefreshToken(client, first.refresh_token!));
});
