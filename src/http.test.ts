import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import express, { ErrorRequestHandler, Request, Response } from "express";
import { AddressInfo } from "node:net";
import { once } from "node:events";
import { mcpJsonParser, mcpJsonPayloadTooLarge, MCP_JSON_BODY_LIMIT_BYTES } from "./http-json.js";
import { FatSecretClient } from "./fatsecret.js";
import { handleDataTool } from "./tools.js";

// Exercise the exact application middleware, without importing HTTP startup,
// configuring OAuth, creating a database, or contacting FatSecret.
async function setup(t: TestContext) {
  const client = new FatSecretClient({ clientId: "offline", clientSecret: "offline" });
  const bodies: Record<string, unknown>[] = [];
  let unhandledErrors = 0;
  client.makeJsonApiRequest = async (_url, body) => {
    bodies.push(body);
    return { success: true };
  };
  const app = express();
  app.post("/mcp", mcpJsonParser, mcpJsonPayloadTooLarge, async (req: Request, res: Response) => {
    const result = await handleDataTool(client, req.body.params.name, req.body.params.arguments);
    res.json({ jsonrpc: "2.0", id: req.body.id, result });
  });
  const fallback: ErrorRequestHandler = (_error, _req, res, _next) => {
    unhandledErrors++;
    res.status(500).json({ error: "server_error" });
  };
  app.use(fallback);
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  return { url, bodies, getUnhandledErrors: () => unhandledErrors };
}

const rpc = (name: string, args: Record<string, unknown>) => JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
});
const post = (url: string, body: string) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body,
});

test("HTTP MCP parser accepts image requests above 100KiB through the documented image limit", async (t) => {
  const { url, bodies, getUnhandledErrors } = await setup(t);
  for (const repetitions of [50000, 249995]) {
    const imageB64 = Buffer.alloc(repetitions * 3).toString("base64"); // 200,000 and 999,980 characters; synthetic binary image payload.
    const body = rpc("recognize_food_image", { imageB64, includeFoodData: false });
    assert.ok(Buffer.byteLength(body) > 102400);
    const response = await post(url, body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.content[0].type, "text");
    assert.equal(bodies.at(-1)!.image_b64, imageB64);
    assert.equal(bodies.at(-1)!.include_food_data, false);
  }
  assert.equal(bodies.length, 2);
  assert.equal(getUnhandledErrors(), 0);
});

test("HTTP MCP parser accommodates UTF-8 expansion and the JSON-RPC envelope", async (t) => {
  const { url, bodies, getUnhandledErrors } = await setup(t);
  const foodName = "🍎".repeat(400000);
  const body = rpc("recognize_food_image", { imageB64: "eA==", eatenFoods: [{ foodId: 1, foodName }] });
  assert.ok(Buffer.byteLength(body) > 1048576);
  assert.ok(Buffer.byteLength(body) < MCP_JSON_BODY_LIMIT_BYTES);
  const response = await post(url, body);
  assert.equal(response.status, 200);
  await response.json();
  assert.deepEqual(bodies[0].eaten_foods, [{ food_id: 1, food_name: foodName }]);
  assert.equal(getUnhandledErrors(), 0);
});

test("HTTP MCP parser returns 413 above the bounded 4MiB limit without calling tools or server-error handler", async (t) => {
  const { url, bodies, getUnhandledErrors } = await setup(t);
  assert.equal(MCP_JSON_BODY_LIMIT_BYTES, 4 * 1024 * 1024);
  const body = rpc("recognize_food_image", { imageB64: "x".repeat(MCP_JSON_BODY_LIMIT_BYTES) });
  assert.ok(Buffer.byteLength(body) > MCP_JSON_BODY_LIMIT_BYTES);
  const response = await post(url, body);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "payload_too_large" });
  assert.equal(bodies.length, 0);
  assert.equal(getUnhandledErrors(), 0);
});

test("HTTP parser middleware forwards unrelated errors unchanged", async (t) => {
  const { url, bodies, getUnhandledErrors } = await setup(t);
  const response = await post(url, "not JSON");
  assert.equal(response.status, 500); // Existing fallback behavior for other errors is unchanged.
  assert.deepEqual(await response.json(), { error: "server_error" });
  assert.equal(bodies.length, 0);
  assert.equal(getUnhandledErrors(), 1);
});
