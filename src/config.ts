import { z } from "zod";

const DEFAULT_PORT = 8080;
const DEFAULT_DATA_DIR = "./data";

const schema = z.object({
  // FatSecret app credentials and the user's OAuth 1.0 access token
  CLIENT_ID: z.string().min(1),
  CLIENT_SECRET: z.string().min(1),
  ACCESS_TOKEN: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(1),
  // Password for the single-user login form on /authorize
  AUTH_PASSWORD: z.string().min(1),
  // Public base URL: OAuth issuer, and resource URL is `${PUBLIC_URL}/mcp`
  PUBLIC_URL: z.url(),
  DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Config = z.infer<typeof schema>;

/** Parses env vars, or prints the offending variable names (never values) and exits non-zero. */
function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Invalid configuration:\n${problems}`);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
