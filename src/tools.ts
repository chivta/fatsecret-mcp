import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { FATSECRET_API_URL, FatSecretClient } from "./fatsecret.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const searchProperties = (subject: string) => ({
  searchExpression: {
    type: "string",
    description: subject,
  },
  pageNumber: {
    type: "number",
    description: "Page number for results (default: 0)",
    default: 0,
  },
  maxResults: {
    type: "number",
    description: "Maximum results per page (default: 20)",
    default: 20,
  },
});

/** MCP definitions of the tools that only need FatSecret credentials/tokens (no local config). */
export const dataTools = [
  {
    name: "search_foods",
    description: "Search for foods in the FatSecret database",
    inputSchema: {
      type: "object",
      properties: searchProperties(
        'Search term for foods (e.g., "chicken breast", "apple")',
      ),
      required: ["searchExpression"],
    },
  },
  {
    name: "get_food",
    description: "Get detailed information about a specific food item",
    inputSchema: {
      type: "object",
      properties: {
        foodId: {
          type: "string",
          description: "The FatSecret food ID",
        },
      },
      required: ["foodId"],
    },
  },
  {
    name: "search_recipes",
    description: "Search for recipes in the FatSecret database",
    inputSchema: {
      type: "object",
      properties: searchProperties("Search term for recipes"),
      required: ["searchExpression"],
    },
  },
  {
    name: "get_recipe",
    description: "Get detailed information about a specific recipe",
    inputSchema: {
      type: "object",
      properties: {
        recipeId: {
          type: "string",
          description: "The FatSecret recipe ID",
        },
      },
      required: ["recipeId"],
    },
  },
  {
    name: "get_user_profile",
    description: "Get the authenticated user's profile information",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_user_food_entries",
    description: "Get user's food diary entries for a specific date",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today)",
        },
      },
    },
  },
  {
    name: "add_food_entry",
    description: "Add a food entry to the user's diary",
    inputSchema: {
      type: "object",
      properties: {
        foodId: {
          type: "string",
          description: "The FatSecret food ID",
        },
        servingId: {
          type: "string",
          description: "The serving ID for the food",
        },
        foodEntryName: {
          type: "string",
          description: "Name shown in the diary (default: the food's name)",
        },
        quantity: {
          type: "number",
          description: "Quantity of the serving",
        },
        mealType: {
          type: "string",
          description: "Meal type (breakfast, lunch, dinner, other)",
          enum: ["breakfast", "lunch", "dinner", "other"],
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today)",
        },
      },
      required: ["foodId", "servingId", "quantity", "mealType"],
    },
  },
  {
    name: "check_auth_status",
    description: "Check if the user is authenticated with FatSecret",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_weight_month",
    description: "Get user's weight entries for a specific month",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Date in YYYY-MM-DD format to specify the month (default: current month)",
        },
      },
    },
  },
];

/** Converts a YYYY-MM-DD date (default: today) to days since 1970-01-01, as FatSecret expects. */
function dateToFatSecretFormat(dateString?: string): string {
  const date = dateString ? new Date(dateString) : new Date();
  const epochStart = new Date("1970-01-01");
  return Math.floor((date.getTime() - epochStart.getTime()) / MS_PER_DAY)
    .toString();
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

/**
 * Runs one API tool call: checks credentials, performs the request and wraps
 * failures in an McpError("Failed to <action>: ...").
 */
async function apiCall(
  client: FatSecretClient,
  opts: {
    action: string;
    method: "GET" | "POST";
    params: Record<string, string>;
    userAuth: boolean;
    format?: (response: unknown) => string;
  },
) {
  const { config } = client;
  if (opts.userAuth) {
    if (!config.accessToken || !config.accessTokenSecret) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "User authentication required. Please complete the OAuth flow first.",
      );
    }
  } else if (!config.clientId || !config.clientSecret) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Please set your FatSecret API credentials first",
    );
  }

  try {
    const response = await client.makeApiRequest(
      opts.method,
      FATSECRET_API_URL,
      { ...opts.params, format: "json" },
      opts.userAuth,
    );
    return textResult(
      opts.format ? opts.format(response) : JSON.stringify(response, null, 2),
    );
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to ${opts.action}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

function checkAuthStatus(client: FatSecretClient) {
  const { config } = client;
  const hasCredentials = !!(config.clientId && config.clientSecret);
  const hasAccessToken = !!(config.accessToken && config.accessTokenSecret);

  let status = "Not configured";
  if (hasCredentials && hasAccessToken) {
    status = "Fully authenticated";
  } else if (hasCredentials) {
    status = "Credentials set, authentication needed";
  }

  return textResult(
    `Authentication Status: ${status}\n\nCredentials configured: ${hasCredentials}\nUser authenticated: ${hasAccessToken}\nUser ID: ${
      config.userId || "N/A"
    }`,
  );
}

/**
 * Dispatches a call to one of `dataTools`. Throws McpError(MethodNotFound)
 * for any other tool name so callers can chain their own tools before it.
 */
export async function handleDataTool(
  client: FatSecretClient,
  name: string,
  args: any = {},
) {
  switch (name) {
    case "search_foods":
      return apiCall(client, {
        action: "search foods",
        method: "GET",
        userAuth: false,
        params: {
          method: "foods.search",
          search_expression: args.searchExpression,
          page_number: args.pageNumber?.toString() || "0",
          max_results: args.maxResults?.toString() || "20",
        },
      });
    case "get_food":
      return apiCall(client, {
        action: "get food",
        method: "GET",
        userAuth: false,
        params: { method: "food.get", food_id: args.foodId },
      });
    case "search_recipes":
      return apiCall(client, {
        action: "search recipes",
        method: "GET",
        userAuth: false,
        params: {
          method: "recipes.search",
          search_expression: args.searchExpression,
          page_number: args.pageNumber?.toString() || "0",
          max_results: args.maxResults?.toString() || "20",
        },
      });
    case "get_recipe":
      return apiCall(client, {
        action: "get recipe",
        method: "GET",
        userAuth: false,
        params: { method: "recipe.get", recipe_id: args.recipeId },
      });
    case "get_user_profile":
      return apiCall(client, {
        action: "get user profile",
        method: "GET",
        userAuth: true,
        params: { method: "profile.get" },
      });
    case "get_user_food_entries":
      return apiCall(client, {
        action: "get food entries",
        method: "GET",
        userAuth: true,
        params: {
          method: "food_entries.get",
          date: dateToFatSecretFormat(args.date),
        },
      });
    case "add_food_entry": {
      // food_entry.create requires food_entry_name; default to the food's own name
      const foodEntryName = args.foodEntryName ?? (await client.makeApiRequest(
        "GET",
        FATSECRET_API_URL,
        { method: "food.get", food_id: args.foodId },
        false,
      )).food.food_name;
      return apiCall(client, {
        action: "add food entry",
        method: "POST",
        userAuth: true,
        params: {
          method: "food_entry.create",
          food_id: args.foodId,
          food_entry_name: foodEntryName,
          serving_id: args.servingId,
          number_of_units: String(args.quantity),
          meal: args.mealType,
          date: dateToFatSecretFormat(args.date),
        },
        format: (response) =>
          `Food entry added successfully!\n\n${
            JSON.stringify(response, null, 2)
          }`,
      });
    }
    case "check_auth_status":
      return checkAuthStatus(client);
    case "get_weight_month":
      return apiCall(client, {
        action: "get weight entries for month",
        method: "GET",
        userAuth: true,
        params: {
          method: "weights.get_month",
          date: dateToFatSecretFormat(args.date),
        },
      });
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
