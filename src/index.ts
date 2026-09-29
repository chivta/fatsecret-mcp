#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import * as dotenv from "dotenv";
import { FatSecretClient, FatSecretConfig } from "./fatsecret.js";
import { dataTools, handleDataTool } from "./tools.js";

// Suppress dotenv console output by temporarily overriding console.log
const originalLog = console.log;
console.log = () => {};
dotenv.config();
console.log = originalLog;

/** Stdio MCP server: the data tools plus tools that manage credentials in ~/.fatsecret-mcp-config.json. */
class FatSecretMCPServer {
  private server: Server;
  private client: FatSecretClient;
  private configPath: string;
  private readonly requestTokenUrl = "https://authentication.fatsecret.com/oauth/request_token";
  private readonly authorizeUrl = "https://authentication.fatsecret.com/oauth/authorize";
  private readonly accessTokenUrl = "https://authentication.fatsecret.com/oauth/access_token";

  constructor() {
    this.server = new Server(
      {
        name: "fatsecret-mcp-server",
        version: "0.1.0",
      },
      { capabilities: { tools: {} } },
    );

    this.configPath = path.join(os.homedir(), ".fatsecret-mcp-config.json");
    this.client = new FatSecretClient({
      clientId: process.env.CLIENT_ID || "",
      clientSecret: process.env.CLIENT_SECRET || "",
    });

    this.setupToolHandlers();
  }

  private get config(): FatSecretConfig {
    return this.client.config;
  }

  private async loadConfig(): Promise<void> {
    try {
      const configData = await fs.readFile(this.configPath, "utf-8");
      Object.assign(this.config, JSON.parse(configData));
    } catch (error) {
      // Config file doesn't exist, will be created when credentials are set
    }
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "set_credentials",
            description:
              "Set FatSecret API credentials (Client ID and Client Secret)",
            inputSchema: {
              type: "object",
              properties: {
                clientId: {
                  type: "string",
                  description: "Your FatSecret Client ID",
                },
                clientSecret: {
                  type: "string",
                  description: "Your FatSecret Client Secret",
                },
              },
              required: ["clientId", "clientSecret"],
            },
          },
          {
            name: "start_oauth_flow",
            description:
              "Start the 3-legged OAuth flow to get user authorization",
            inputSchema: {
              type: "object",
              properties: {
                callbackUrl: {
                  type: "string",
                  description: 'OAuth callback URL (use "oob" for out-of-band)',
                  default: "oob",
                },
              },
            },
          },
          {
            name: "complete_oauth_flow",
            description:
              "Complete the OAuth flow with the authorization code/verifier",
            inputSchema: {
              type: "object",
              properties: {
                requestToken: {
                  type: "string",
                  description: "The request token from start_oauth_flow",
                },
                requestTokenSecret: {
                  type: "string",
                  description: "The request token secret from start_oauth_flow",
                },
                verifier: {
                  type: "string",
                  description:
                    "The OAuth verifier from the callback or authorization page",
                },
              },
              required: ["requestToken", "requestTokenSecret", "verifier"],
            },
          },
          ...dataTools,
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.loadConfig();

      switch (request.params.name) {
        case "set_credentials":
          return await this.handleSetCredentials(request.params.arguments);
        case "start_oauth_flow":
          return await this.handleStartOAuthFlow(request.params.arguments);
        case "complete_oauth_flow":
          return await this.handleCompleteOAuthFlow(request.params.arguments);
        default:
          return await handleDataTool(
            this.client,
            request.params.name,
            request.params.arguments,
          );
      }
    });
  }

  private async handleSetCredentials(args: any) {
    this.config.clientId = args.clientId;
    this.config.clientSecret = args.clientSecret;
    await this.saveConfig();

    return {
      content: [
        {
          type: "text",
          text:
            "FatSecret API credentials have been set successfully. You can now start the OAuth flow to authenticate users.",
        },
      ],
    };
  }

  private async handleStartOAuthFlow(args: any) {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Please set your FatSecret API credentials first using set_credentials",
      );
    }

    const callbackUrl = args.callbackUrl || "oob";

    try {
      const response = await this.client.makeOAuthRequest(
        "POST",
        this.requestTokenUrl,
        { oauth_callback: callbackUrl },
      );

      const token = response.oauth_token as string;
      const tokenSecret = response.oauth_token_secret as string;
      const authUrl = `${this.authorizeUrl}?oauth_token=${token}`;

      return {
        content: [
          {
            type: "text",
            text:
              `OAuth flow started successfully!\n\nRequest Token: ${token}\nRequest Token Secret: ${tokenSecret}\n\nPlease visit this URL to authorize the application:\n${authUrl}\n\nAfter authorization, you'll receive a verifier code. Use the complete_oauth_flow tool with the request token, request token secret, and verifier to complete the authentication.`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to start OAuth flow: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async handleCompleteOAuthFlow(args: any) {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Please set your FatSecret API credentials first",
      );
    }

    try {
      const response = await this.client.makeOAuthRequest(
        "GET",
        this.accessTokenUrl,
        { oauth_verifier: args.verifier },
        args.requestToken,
        args.requestTokenSecret,
      );

      const tokenData = response as any;

      this.config.accessToken = tokenData.oauth_token;
      this.config.accessTokenSecret = tokenData.oauth_token_secret;
      this.config.userId = tokenData.user_id;

      await this.saveConfig();

      return {
        content: [
          {
            type: "text",
            text:
              `OAuth flow completed successfully! You are now authenticated with FatSecret.\n\nUser ID: ${this.config.userId}\n\nYou can now use user-specific tools like get_user_profile, get_user_food_entries, and add_food_entry.`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to complete OAuth flow: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("FatSecret MCP server running on stdio");
  }
}

const server = new FatSecretMCPServer();
server.run().catch(console.error);
