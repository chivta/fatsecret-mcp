import crypto from "crypto";
import fetch from "node-fetch";
import querystring from "querystring";

export interface FatSecretConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  accessTokenSecret?: string;
  userId?: string;
}

export const FATSECRET_API_URL = "https://platform.fatsecret.com/rest/server.api";

/**
 * FatSecret REST client with OAuth 1.0 (HMAC-SHA1) request signing.
 * `config` is public and mutable: the stdio server updates it as credentials change.
 */
export class FatSecretClient {
  constructor(public config: FatSecretConfig) {}

  private generateNonce(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  private generateTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      );
  }

  private createSignatureBaseString(
    method: string,
    url: string,
    parameters: Record<string, string>,
  ): string {
    const sortedParams = Object.keys(parameters)
      .sort()
      .map((key) =>
        `${this.percentEncode(key)}=${this.percentEncode(parameters[key])}`
      )
      .join("&");

    return [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(sortedParams),
    ].join("&");
  }

  private createSigningKey(
    clientSecret: string,
    tokenSecret: string = "",
  ): string {
    return `${this.percentEncode(clientSecret)}&${
      this.percentEncode(tokenSecret)
    }`;
  }

  private generateSignature(
    method: string,
    url: string,
    parameters: Record<string, string>,
    clientSecret: string,
    tokenSecret: string = "",
  ): string {
    const baseString = this.createSignatureBaseString(method, url, parameters);
    const signingKey = this.createSigningKey(clientSecret, tokenSecret);

    return crypto
      .createHmac("sha1", signingKey)
      .update(baseString)
      .digest("base64");
  }

  /** Signs and sends a request, returning parsed JSON (or a parsed query string). */
  private async signedRequest(
    method: string,
    url: string,
    params: Record<string, string>,
    token: string | undefined,
    tokenSecret: string | undefined,
    errorPrefix: string,
  ): Promise<any> {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.config.clientId,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: this.generateTimestamp(),
      oauth_version: "1.0",
    };

    if (token) {
      oauthParams.oauth_token = token;
    }

    // The signature covers OAuth and regular parameters together
    const allParams = { ...params, ...oauthParams };
    allParams.oauth_signature = this.generateSignature(
      method,
      url,
      allParams,
      this.config.clientSecret,
      tokenSecret,
    );

    const options: any = {
      method,
      headers: {},
    };

    let requestUrl = url;
    if (method === "GET") {
      requestUrl += "?" + querystring.stringify(allParams);
    } else if (method === "POST") {
      options.headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.body = querystring.stringify(allParams);
    }

    const response = await fetch(requestUrl, options);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${errorPrefix}: ${response.status} - ${text}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return querystring.parse(text);
    }
  }

  /** Request against the FatSecret OAuth endpoints (request/access token exchange). */
  async makeOAuthRequest(
    method: string,
    url: string,
    params: Record<string, string> = {},
    token?: string,
    tokenSecret?: string,
  ): Promise<any> {
    return this.signedRequest(method, url, params, token, tokenSecret, "OAuth error");
  }

  /**
   * Request against the REST API. With `useAccessToken` the request is signed
   * with the user's access token, otherwise it is a consumer-only request.
   */
  async makeApiRequest(
    method: string,
    url: string,
    params: Record<string, string> = {},
    useAccessToken: boolean = true,
  ): Promise<any> {
    params.format = "json";
    const signWithUser = useAccessToken && this.config.accessToken &&
      this.config.accessTokenSecret;
    const result = await this.signedRequest(
      method,
      url,
      params,
      signWithUser ? this.config.accessToken : undefined,
      useAccessToken ? this.config.accessTokenSecret : undefined,
      "FatSecret API error",
    );
    // The REST API reports failures as HTTP 200 with an `error` object
    if (result?.error) {
      throw new Error(
        `FatSecret API error: ${result.error.code} - ${result.error.message}`,
      );
    }
    return result;
  }
}
