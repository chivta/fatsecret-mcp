#!/usr/bin/env node

import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { metricsRegistry } from "./metrics.js";
import { FatSecretClient } from "./fatsecret.js";
import { dataTools, handleDataTool } from "./tools.js";
import { initAuthSchema, SingleUserOAuthProvider } from "./oauth.js";

const MCP_PATH = "/mcp";
const RESOURCE_NAME = "FatSecret";
// Number of reverse proxies in front of the server (ingress); used for client IPs in rate limiting
const TRUSTED_PROXY_HOPS = 1;
const HTTP_METHOD_NOT_ALLOWED = 405;

// FatSecret credentials come from env only in HTTP mode
const fatSecret = new FatSecretClient({
  clientId: config.CLIENT_ID,
  clientSecret: config.CLIENT_SECRET,
  accessToken: config.ACCESS_TOKEN,
  accessTokenSecret: config.ACCESS_TOKEN_SECRET,
});

/** Builds a fresh MCP server exposing only the data tools (stateless: one per request). */
function createMcpServer(): Server {
  const server = new Server(
    { name: "fatsecret-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: dataTools,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await handleDataTool(
        fatSecret,
        request.params.name,
        request.params.arguments,
      );
    } catch (err) {
      logger.error({ err, tool: request.params.name }, "tool call failed");
      throw err;
    }
  });
  return server;
}

fs.mkdirSync(config.DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(config.DATA_DIR, "auth.db"));
initAuthSchema(db);
const provider = new SingleUserOAuthProvider(db, config.AUTH_PASSWORD);

const issuerUrl = new URL(config.PUBLIC_URL);
const resourceUrl = new URL(MCP_PATH, issuerUrl);

const app = express();
app.set("trust proxy", TRUSTED_PROXY_HOPS);

app.get("/health", (_req, res) => {
  res.type("text").send("ok");
});

app.get("/metrics", async (_req, res) => {
  res.type(metricsRegistry.contentType).send(await metricsRegistry.metrics());
});

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl: resourceUrl,
    resourceName: RESOURCE_NAME,
  }),
);

// The SDK only serves the path-suffixed metadata (/.well-known/oauth-protected-resource/mcp);
// also serve the root form for clients that probe it.
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: resourceUrl.href,
    authorization_servers: [issuerUrl.href],
    resource_name: RESOURCE_NAME,
  });
});

const bearerAuth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
});

app.post(MCP_PATH, bearerAuth, express.json(), async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Stateless mode has no server-initiated streams or sessions to close
app.all(MCP_PATH, bearerAuth, (_req, res) => {
  res.status(HTTP_METHOD_NOT_ALLOWED).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

// Last resort: log once here, respond without details
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "unhandled request error");
  if (!res.headersSent) {
    res.status(500).json({ error: "server_error" });
  }
});

const httpServer = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, publicUrl: config.PUBLIC_URL }, "server listening");
});

// Container stop: finish in-flight requests, then close the DB
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
