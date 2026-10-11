import express, { ErrorRequestHandler } from "express";

// Accommodate a ~1MiB tool body, UTF-8 expansion, and the JSON-RPC envelope.
// Upstream operation-specific limits still apply after tool argument validation.
export const MCP_JSON_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

export const mcpJsonParser = express.json({ limit: MCP_JSON_BODY_LIMIT_BYTES });

/** Parser overflow is a client error, not an unhandled server failure. */
export const mcpJsonPayloadTooLarge: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  next(err);
};
