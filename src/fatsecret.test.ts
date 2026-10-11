import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fetch, { Response } from "node-fetch";
import { FATSECRET_API_URL, FatSecretClient } from "./fatsecret.js";

function setup(response = new Response('{"success":true}', { status: 200 })) {
  const calls: { url: string; options: Parameters<typeof fetch>[1] }[] = [];
  const transport: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return response.clone();
  };
  const client = new FatSecretClient({
    clientId: "offline-key", clientSecret: "offline-secret",
    accessToken: "offline-token", accessTokenSecret: "offline-token-secret",
  }, transport);
  // Fix request entropy for independent signature verification; never use live credentials.
  Object.defineProperty(client, "generateNonce", { value: () => "fixed-nonce" });
  Object.defineProperty(client, "generateTimestamp", { value: () => "1234567890" });
  return { client, calls };
}

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
  (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function expectedSignature(method: string, url: string, params: URLSearchParams, userAuth: boolean) {
  const normalized = [...params].filter(([key]) => key !== "oauth_signature")
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join("&");
  const base = [method, url, normalized].map(encode).join("&");
  return crypto.createHmac("sha1", `${encode("offline-secret")}&${userAuth ? encode("offline-token-secret") : ""}`)
    .update(base).digest("base64");
}

test("FatSecretClient JSON POST signs only OAuth query fields, preserving JSON types", async () => {
  const { client, calls } = setup();
  const url = "https://platform.fatsecret.com/rest/natural-language-processing/v1";
  const body = {
    user_input: "toast & café", include_food_data: false,
    eaten_foods: [{ food_id: 3092, food_name: "egg", serving_size: "0" }],
  };
  assert.deepEqual(await client.makeJsonApiRequest(url, body), { success: true });
  assert.equal(calls.length, 1);
  const request = new URL(calls[0].url);
  assert.equal(request.origin + request.pathname, url);
  assert.deepEqual([...request.searchParams.keys()].sort(), [
    "oauth_consumer_key", "oauth_nonce", "oauth_signature", "oauth_signature_method", "oauth_timestamp", "oauth_version",
  ]);
  assert.equal(request.searchParams.get("oauth_signature"), expectedSignature("POST", url, request.searchParams, false));
  assert.equal(calls[0].options!.method, "POST");
  assert.deepEqual(calls[0].options!.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(calls[0].options!.body)), body);
  assert.equal(request.searchParams.has("oauth_token"), false); // Consumer-only despite configured user tokens.
});

test("JSON body is not part of the OAuth1 signature, but endpoint is", async () => {
  const { client, calls } = setup();
  const nlpUrl = "https://platform.fatsecret.com/rest/natural-language-processing/v1";
  await client.makeJsonApiRequest(nlpUrl, { user_input: "egg" });
  await client.makeJsonApiRequest(nlpUrl, { user_input: "toast" });
  await client.makeJsonApiRequest("https://platform.fatsecret.com/rest/image-recognition/v2", { image_b64: "eA==" });
  const signatures = calls.map((c) => new URL(c.url).searchParams.get("oauth_signature"));
  assert.equal(signatures[0], signatures[1]);
  assert.notEqual(signatures[0], signatures[2]);
});

for (const method of ["GET", "POST"] as const) {
  for (const userAuth of [true, false]) {
    test(`legacy ${method} form transport and ${userAuth ? "user" : "consumer"} signature remain unchanged`, async () => {
      const { client, calls } = setup();
      const params = { method: "food.get", food_id: "123", note: "a & b!" };
      assert.deepEqual(await client.makeApiRequest(method, FATSECRET_API_URL, params, userAuth), { success: true });
      const request = new URL(calls[0].url);
      const sent = method === "GET" ? request.searchParams : new URLSearchParams(String(calls[0].options!.body));
      assert.equal(sent.get("oauth_signature"), expectedSignature(method, FATSECRET_API_URL, sent, userAuth));
      assert.equal(sent.get("food_id"), "123");
      assert.equal(sent.get("note"), "a & b!");
      assert.equal(sent.get("format"), "json");
      assert.equal(sent.get("oauth_token"), userAuth ? "offline-token" : null);
      assert.equal(calls[0].options!.method, method);
      if (method === "POST") {
        assert.equal(calls[0].url, FATSECRET_API_URL);
        assert.deepEqual(calls[0].options!.headers, { "Content-Type": "application/x-www-form-urlencoded" });
      } else assert.equal(calls[0].options!.body, undefined);
    });
  }
}

for (const [name, response, message] of [
  ["HTTP error", new Response("Access denied", { status: 403 }), /FatSecret API error: 403 - Access denied/],
  ["FatSecret error envelope", new Response('{"error":{"code":211,"message":"No match"}}'), /FatSecret API error: 211 - No match/],
  ["invalid JSON", new Response("not JSON"), /Unexpected token/],
] as const) {
  test(`JSON transport propagates ${name}`, async () => {
    const { client } = setup(response);
    await assert.rejects(client.makeJsonApiRequest("https://platform.fatsecret.com/rest/feedback/v1", {}), message);
  });
}

test("JSON transport propagates network errors", async () => {
  const transport: typeof fetch = async () => { throw new Error("offline network failure"); };
  const client = new FatSecretClient({ clientId: "offline", clientSecret: "offline" }, transport);
  await assert.rejects(client.makeJsonApiRequest("https://platform.fatsecret.com/rest/feedback/v1", {}), /offline network failure/);
});
