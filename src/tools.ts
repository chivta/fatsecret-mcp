import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { FATSECRET_API_URL, FatSecretClient } from "./fatsecret.js";
import {
  addIsoDates,
  catalogTools,
  isUnknownMethodError,
  NUMBER_OF_UNITS,
  PREMIER_ERROR_SUFFIX,
  prepareCatalogCall,
  REFERENCE_SERVING_ID,
  roundTo,
  toArray,
  toolCatalog,
} from "./tool-catalog.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "other"];
const METRIC_UNITS = ["g", "ml"];
/** Below this, numberOfUnits on a g/ml serving is almost certainly a serving count typed by mistake. */
const MIN_PLAUSIBLE_METRIC_UNITS = 5;
const NUMBER_OF_UNITS_DECIMALS = 3;
/** Per-100 reference amount used in the "For 60 g pass 60" hint of the guard. */
const REFERENCE_AMOUNT = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** McpError prepends this to its message; stripped when an error is re-wrapped. */
const MCP_ERROR_PREFIX = /^MCP error -?\d+: /;

const writeAnnotations = (destructive: boolean) => ({
  readOnlyHint: false,
  destructiveHint: destructive,
  openWorldHint: true,
});

/** MCP definitions of the tools that only need FatSecret credentials/tokens (no local config). */
export const dataTools = [
  {
    name: "add_food_entry",
    description:
      'Add a food to the diary and return the created entry (food_entry_description, calories, protein, fat, carbohydrate), so the logged amount can be checked at once. Give the amount in one of two ways. (1) amount + unit for a weight or volume: amount 250, unit "g". The server picks a serving and converts. (2) servingId + numberOfUnits for counted servings: two bars is the "1 bar" servingId with numberOfUnits 2.',
    inputSchema: {
      type: "object",
      properties: {
        foodId: { type: "string", description: "The FatSecret food ID" },
        meal: {
          type: "string",
          description: "Meal type (breakfast, lunch, dinner, other)",
          enum: MEAL_TYPES,
        },
        date: {
          type: "string",
          description:
            "Date in YYYY-MM-DD format. Default: today in UTC; pass it explicitly.",
        },
        foodEntryName: {
          type: "string",
          description: "Name shown in the diary (default: the food's name)",
        },
        amount: {
          type: "number",
          description:
            'Weight or volume eaten, in unit. 300 ml of milk is amount 300, unit "ml".',
        },
        unit: {
          type: "string",
          description: "Unit of amount",
          enum: METRIC_UNITS,
        },
        servingId: {
          type: "string",
          description: "The serving ID for the food (from get_food)",
        },
        numberOfUnits: {
          type: "number",
          description:
            `${NUMBER_OF_UNITS} Values under ${MIN_PLAUSIBLE_METRIC_UNITS} on a g/ml serving are rejected unless force is true.`,
        },
        force: {
          type: "boolean",
          description:
            `Set true only to log fewer than ${MIN_PLAUSIBLE_METRIC_UNITS} g or ml on a g/ml serving (2 g of salt).`,
        },
      },
      required: ["foodId", "meal"],
      additionalProperties: false,
    },
    annotations: writeAnnotations(false),
  },
  {
    name: "update_food_entry",
    description:
      "Change a diary entry in place (same food_entry_id): its amount, serving, meal or name. The food and the date cannot be changed. Returns the updated entry with recalculated calories.",
    inputSchema: {
      type: "object",
      properties: {
        foodEntryId: {
          type: "string",
          description: "The food entry ID retrieved by get_user_food_entries",
        },
        foodEntryName: {
          type: "string",
          description: "Name shown in the diary",
        },
        servingId: {
          type: "string",
          description: "The serving ID for the food (from get_food)",
        },
        numberOfUnits: {
          type: "number",
          description:
            `${NUMBER_OF_UNITS} Values under ${MIN_PLAUSIBLE_METRIC_UNITS} on a g/ml serving are rejected unless force is true.`,
        },
        meal: {
          type: "string",
          description: "Meal type (breakfast, lunch, dinner, other)",
          enum: MEAL_TYPES,
        },
        force: {
          type: "boolean",
          description:
            `Set true only to log fewer than ${MIN_PLAUSIBLE_METRIC_UNITS} g or ml on a g/ml serving (2 g of salt).`,
        },
      },
      required: ["foodEntryId"],
      anyOf: [
        { required: ["foodEntryName"] },
        { required: ["servingId"] },
        { required: ["numberOfUnits"] },
        { required: ["meal"] },
      ],
      additionalProperties: false,
    },
    annotations: writeAnnotations(true),
  },
  {
    name: "delete_food_entry",
    description:
      "Delete a diary entry by its food_entry_id (from get_user_food_entries). Cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        foodEntryId: {
          type: "string",
          description: "The food entry ID retrieved by get_user_food_entries",
        },
      },
      required: ["foodEntryId"],
    },
    annotations: writeAnnotations(true),
  },
  {
    name: "check_auth_status",
    description: "Check if the user is authenticated with FatSecret",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  ...catalogTools,
];

/** Converts a YYYY-MM-DD date (default: today, UTC) to days since 1970-01-01, as FatSecret expects. */
function dateToFatSecretFormat(dateString?: string): string {
  const date = dateString ? new Date(dateString) : new Date();
  const epochStart = new Date("1970-01-01");
  return Math.floor((date.getTime() - epochStart.getTime()) / MS_PER_DAY)
    .toString();
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

const invalid = (message: string): never => {
  throw new McpError(ErrorCode.InvalidParams, message);
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

/** Throws McpError(InvalidRequest) when the credentials a call needs are missing. */
function requireCredentials(client: FatSecretClient, userAuth: boolean) {
  const { config } = client;
  if (userAuth) {
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
    url?: string;
    jsonBody?: Record<string, unknown>;
    premier?: boolean;
    transform?: (response: any) => unknown;
    format?: (response: unknown) => string;
  },
) {
  requireCredentials(client, opts.userAuth);

  try {
    const response = opts.jsonBody
      ? await client.makeJsonApiRequest(opts.url!, opts.jsonBody)
      : await client.makeApiRequest(
        opts.method,
        opts.url ?? FATSECRET_API_URL,
        { ...opts.params, format: "json" },
        opts.userAuth,
      );
    const processed = addIsoDates(
      opts.transform ? opts.transform(response) : response,
    );
    return textResult(
      opts.format ? opts.format(processed) : JSON.stringify(processed, null, 2),
    );
  } catch (error) {
    const message = errorText(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to ${opts.action}: ${message}${
        opts.premier && isUnknownMethodError(message) ? PREMIER_ERROR_SUFFIX : ""
      }`,
    );
  }
}

/** One REST call whose failure is wrapped in an McpError("Failed to <action>: ..."). */
async function request(
  client: FatSecretClient,
  action: string,
  method: "GET" | "POST",
  params: Record<string, string>,
  userAuth: boolean,
): Promise<any> {
  try {
    return await client.makeApiRequest(
      method,
      FATSECRET_API_URL,
      { ...params, format: "json" },
      userAuth,
    );
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to ${action}: ${errorText(error)}`,
    );
  }
}

interface Food {
  name: string;
  servings: any[];
}

/** Fetches a food with food.get.v5 (consumer-signed), servings always as an array. */
async function fetchFood(client: FatSecretClient, foodId: string): Promise<Food> {
  const response = await request(
    client,
    "get food",
    "GET",
    { method: "food.get.v5", food_id: foodId },
    false,
  );
  return {
    name: response?.food?.food_name,
    servings: toArray(response?.food?.servings?.serving),
  };
}

/** Lists the serving_id and description of every loggable serving, for error messages. */
const describeServings = (food: Food) =>
  food.servings.filter((s) => s.serving_id !== REFERENCE_SERVING_ID)
    .map((s) => `${s.serving_id} (${s.serving_description})`).join(", ");

function rejectReferenceServing(servingId: string | undefined) {
  if (servingId === REFERENCE_SERVING_ID) {
    invalid(
      `servingId "${REFERENCE_SERVING_ID}" is a derived per-100 reference serving and cannot be logged. Use another serving from get_food.`,
    );
  }
}

/** Way 1: picks the serving for `amount` of `unit` and converts the amount to numberOfUnits. */
function resolveByAmount(food: Food, amount: number, unit: string) {
  const usable = food.servings.filter((s) => s.serving_id !== REFERENCE_SERVING_ID);
  const direct = usable.find((s) => s.measurement_description === unit);
  if (direct) return { servingId: String(direct.serving_id), numberOfUnits: amount };
  const metric = usable.find((s) =>
    s.metric_serving_unit === unit && Number(s.metric_serving_amount) > 0
  );
  if (metric) {
    const servingUnits = Number(metric.number_of_units) || 1;
    return {
      servingId: String(metric.serving_id),
      numberOfUnits: roundTo(
        amount / Number(metric.metric_serving_amount) * servingUnits,
        NUMBER_OF_UNITS_DECIMALS,
      ),
    };
  }
  return invalid(
    `No serving of this food is measured in ${unit}. Servings: ${describeServings(food)}. Use servingId + numberOfUnits.`,
  );
}

/**
 * Way 2 checks: the serving must exist on the food (when the food is known) and
 * a tiny amount on a g/ml serving is rejected unless forced.
 */
function checkServing(
  food: Food | undefined,
  servingId: string,
  numberOfUnits: number,
  force: boolean | undefined,
) {
  if (!food) return;
  const serving = food.servings.find((s) => s.serving_id === servingId);
  if (!serving) {
    invalid(
      `The food has no serving ${servingId}. Servings: ${describeServings(food)}.`,
    );
  }
  const unit = serving.measurement_description;
  if (
    METRIC_UNITS.includes(unit) && numberOfUnits < MIN_PLAUSIBLE_METRIC_UNITS &&
    !force
  ) {
    const kcal = Number(serving.calories) * numberOfUnits /
      Number(serving.number_of_units);
    const kcalText = Number.isFinite(kcal) ? ` (about ${Math.round(kcal)} kcal)` : "";
    const hint = roundTo(numberOfUnits * REFERENCE_AMOUNT, NUMBER_OF_UNITS_DECIMALS);
    invalid(
      `numberOfUnits counts ${unit} on serving "${serving.serving_description}", so ${numberOfUnits} logs ${numberOfUnits} ${unit}${kcalText}. For ${hint} ${unit} pass ${hint}. Pass force: true only if ${numberOfUnits} ${unit} is really intended.`,
    );
  }
}

/** Reads one diary entry by id with food_entries.get.v2. */
async function readEntry(client: FatSecretClient, foodEntryId: string) {
  const response = await request(
    client,
    "get food entry",
    "GET",
    { method: "food_entries.get.v2", food_entry_id: foodEntryId },
    true,
  );
  const entry = toArray(response?.food_entries?.food_entry)[0];
  if (!entry) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get food entry: ${foodEntryId} not found`,
    );
  }
  return entry;
}

/**
 * Result text of a diary write: the entry read back from FatSecret. A failed
 * read-back still reports the write as done, so it never looks like a failed write.
 */
async function writeResult(
  client: FatSecretClient,
  verb: "added" | "updated",
  foodEntryId: string,
) {
  try {
    const entry = addIsoDates(await readEntry(client, foodEntryId));
    return textResult(
      `Food entry ${verb} successfully!\n\n${JSON.stringify(entry, null, 2)}`,
    );
  } catch (error) {
    const next = verb === "added" ? "add it again" : "repeat the change";
    return textResult(
      `Food entry ${verb} successfully (food_entry_id ${foodEntryId}), but reading it back failed: ${
        errorText(error)
      }. Do not ${next}; check with get_user_food_entries.`,
    );
  }
}

/** food_entry.create returns the new id as `food_entry_id.value` (or as a plain string). */
function createdEntryId(response: any): string | undefined {
  const id = response?.food_entry_id;
  const value = typeof id === "object" && id !== null ? id.value : id;
  return value === undefined || value === null ? undefined : String(value);
}

function checkTypes(args: any, types: Record<string, string>) {
  for (const [key, type] of Object.entries(types)) {
    if (args[key] !== undefined && typeof args[key] !== type) {
      invalid(`${key} must be a ${type}`);
    }
  }
  for (const key of ["amount", "numberOfUnits"]) {
    if (args[key] !== undefined && !(args[key] > 0)) invalid(`${key} must be a number above 0`);
  }
}

async function addFoodEntry(client: FatSecretClient, args: any) {
  checkTypes(args, {
    foodId: "string", meal: "string", date: "string", foodEntryName: "string",
    amount: "number", unit: "string", servingId: "string", numberOfUnits: "number",
    force: "boolean",
  });
  if (!args.foodId) invalid("foodId is required");
  if (!MEAL_TYPES.includes(args.meal)) invalid(`meal must be one of ${MEAL_TYPES.join(", ")}`);
  if (args.date !== undefined && (!DATE_PATTERN.test(args.date) || Number.isNaN(Date.parse(args.date)))) {
    invalid("date must be a real YYYY-MM-DD date");
  }
  const byAmount = args.amount !== undefined || args.unit !== undefined;
  const byServing = args.servingId !== undefined || args.numberOfUnits !== undefined;
  if (byAmount === byServing) {
    invalid("Give the amount in exactly one way: amount + unit, or servingId + numberOfUnits.");
  }
  if (byAmount) {
    if (args.amount === undefined || !METRIC_UNITS.includes(args.unit)) {
      invalid(`amount and unit (${METRIC_UNITS.join(" or ")}) must be given together.`);
    }
  } else {
    if (args.servingId === undefined || args.numberOfUnits === undefined) {
      invalid("servingId and numberOfUnits must be given together.");
    }
    rejectReferenceServing(args.servingId);
  }
  requireCredentials(client, true);
  requireCredentials(client, false);

  // Without the food only way 2 with an explicit name can proceed, unguarded.
  let food: Food | undefined;
  try {
    food = await fetchFood(client, args.foodId);
  } catch (error) {
    if (byAmount || args.foodEntryName === undefined) {
      throw new McpError(
        ErrorCode.InternalError,
        `${errorText(error).replace(MCP_ERROR_PREFIX, "")}. A food that food.get cannot read (e.g. one logged from the mobile app) can still be logged with servingId + numberOfUnits + foodEntryName.`,
      );
    }
  }
  let { servingId, numberOfUnits } = args;
  if (byAmount) {
    ({ servingId, numberOfUnits } = resolveByAmount(food!, args.amount, args.unit));
  } else {
    checkServing(food, servingId, numberOfUnits, args.force);
  }
  const response = await request(client, "add food entry", "POST", {
    method: "food_entry.create",
    food_id: args.foodId,
    food_entry_name: args.foodEntryName ?? food!.name,
    serving_id: servingId,
    number_of_units: String(numberOfUnits),
    meal: args.meal,
    date: dateToFatSecretFormat(args.date),
  }, true);
  const id = createdEntryId(response);
  if (!id) {
    return textResult(
      `Food entry added successfully, but FatSecret returned no food_entry_id to read it back: ${
        JSON.stringify(response)
      }. Do not add it again; check with get_user_food_entries.`,
    );
  }
  return writeResult(client, "added", id);
}

async function updateFoodEntry(client: FatSecretClient, args: any) {
  checkTypes(args, {
    foodEntryId: "string", foodEntryName: "string", servingId: "string",
    numberOfUnits: "number", meal: "string", force: "boolean",
  });
  if (!args.foodEntryId) invalid("foodEntryId is required");
  if (args.meal !== undefined && !MEAL_TYPES.includes(args.meal)) {
    invalid(`meal must be one of ${MEAL_TYPES.join(", ")}`);
  }
  const params: Record<string, string> = {
    method: "food_entry.edit",
    food_entry_id: args.foodEntryId,
  };
  if (args.foodEntryName !== undefined) params.food_entry_name = args.foodEntryName;
  if (args.servingId !== undefined) params.serving_id = args.servingId;
  if (args.numberOfUnits !== undefined) params.number_of_units = String(args.numberOfUnits);
  if (args.meal !== undefined) params.meal = args.meal;
  if (Object.keys(params).length === 2) {
    invalid(
      "At least one update field is required: foodEntryName, servingId, numberOfUnits, or meal.",
    );
  }
  rejectReferenceServing(args.servingId);
  requireCredentials(client, true);

  if (args.numberOfUnits !== undefined || args.servingId !== undefined) {
    const entry = await readEntry(client, args.foodEntryId);
    let food: Food | undefined;
    try {
      food = await fetchFood(client, entry.food_id);
    } catch {
      // Unknown food (e.g. a non-US food from the mobile app): update without the guard.
    }
    const servingId = args.servingId ?? entry.serving_id;
    // Only a serving the caller named must exist on the food; the entry's own
    // serving may be missing from food.get, and then there is nothing to guard.
    if (
      args.servingId !== undefined ||
      food?.servings.some((s) => s.serving_id === servingId)
    ) {
      checkServing(
        food,
        servingId,
        args.numberOfUnits ?? Number(entry.number_of_units),
        args.force,
      );
    }
  }
  await request(client, "update food entry", "POST", params, true);
  return writeResult(client, "updated", args.foodEntryId);
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
  const operation = toolCatalog.find((entry) => entry.name === name);
  if (operation) {
    const { params, body } = prepareCatalogCall(operation, args);
    return apiCall(client, {
      action: operation.name.replace(/_/g, " "),
      method: operation.httpMethod,
      userAuth: operation.userAuth,
      url: operation.url,
      params,
      premier: operation.premier,
      transform: operation.transform,
      ...(operation.json && { jsonBody: body }),
    });
  }
  switch (name) {
    case "add_food_entry":
      return addFoodEntry(client, args);
    case "update_food_entry":
      return updateFoodEntry(client, args);
    case "delete_food_entry":
      return apiCall(client, {
        action: "delete food entry",
        method: "POST",
        userAuth: true,
        params: {
          method: "food_entry.delete",
          food_entry_id: args.foodEntryId,
        },
        format: (response) =>
          `Food entry deleted successfully!\n\n${
            JSON.stringify(response, null, 2)
          }`,
      });
    case "check_auth_status":
      return checkAuthStatus(client);
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
