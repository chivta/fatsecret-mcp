import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export interface ValueSchema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: ValueSchema;
  properties?: Record<string, ValueSchema>;
  required?: string[];
  additionalProperties?: boolean;
}
interface Field {
  name: string;
  apiName: string;
  schema: ValueSchema;
  required: boolean;
}
interface ConditionalRequirement {
  field: string;
  values: (string | number)[];
  required: string[];
}
interface Operation {
  docPath: string;
  name: string;
  description: string;
  method?: string;
  url?: string;
  json?: boolean;
  httpMethod: "GET" | "POST";
  userAuth: boolean;
  destructive?: boolean;
  /** Not included in the Basic plan: FatSecret answers error 10 "Unknown method". */
  premier?: boolean;
  /** Reshapes the parsed response before it is serialised. */
  transform?: (response: any) => unknown;
  /** Uses today's UTC date when neither `date` nor `food_entry_id` is given. */
  defaultsToToday?: boolean;
  fields: Field[];
  atLeastOne?: string[];
  conditions?: ConditionalRequirement[];
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const PREMIER_PREFIX = "[FatSecret Premier plan only; a Basic key answers error 10] ";
/** FatSecret error code for a method the API key's plan does not include. */
const UNKNOWN_METHOD_ERROR_CODE = "10";
export const PREMIER_ERROR_SUFFIX = ". This method is not included in the API key's FatSecret plan (Premier required).";
const DEFAULT_DAY = "Default: FatSecret's current day; pass it explicitly to avoid timezone surprises.";
export const NUMBER_OF_UNITS = "Amount in units of the serving's measurement_description (see get_food), not a count of servings. On a serving measured in g or ml it is grams or ml: 250 g on the \"100 g\" serving is 250, never 2.5. On a serving measured in bar, cup, piece or serving it is a count: half a bar is 0.5.";
const ENTRY_ROUNDING = 2;
const KCAL_PER_UNIT_ROUNDING = 4;
export const REFERENCE_SERVING_ID = "0";

const meals = ["breakfast", "lunch", "dinner", "other"];
const field = (apiName: string, schema: ValueSchema, required = false): Field => ({
  name: apiName.replace(/[_.]([a-z])/g, (_, letter: string) => letter.toUpperCase()),
  apiName, schema, required,
});
const string = (description: string, options: Partial<ValueSchema> = {}): ValueSchema =>
  ({ type: "string", description, ...options });
const number = (description: string): ValueSchema => ({ type: "number", description });
const integer = (description: string, options: Partial<ValueSchema> = {}): ValueSchema =>
  ({ type: "integer", description, ...options });
const boolean = (description: string): ValueSchema => ({ type: "boolean", description });
const date = (description: string): ValueSchema => string(
  `YYYY-MM-DD calendar date, converted to days since 1970-01-01. ${description}`,
  { format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
);
const PREMIER_PARAM = "Premier plan feature.";
const REGION = string(`Two-letter country code that filters results by region ("FR" returns results from France). Default: "US". Localization is a ${PREMIER_PARAM}`);
const LANGUAGE = string(`Two-letter language code for the results ("fr" returns French); ignored unless region is given. Localization is a ${PREMIER_PARAM}`);
const mealList: ValueSchema = {
  type: "array", description: "Meals the saved meal is suitable for; sent as a comma-separated list.",
  items: string("Meal type", { enum: meals }),
};
const eatenFoods: ValueSchema = {
  type: "array", description: "Previously consumed foods to improve matching. Optional fields should be omitted, not null.",
  items: {
    type: "object", description: "Previously consumed food", additionalProperties: false,
    properties: {
      foodId: integer("Previously consumed food ID"),
      foodName: string("Previously consumed food name"),
      foodBrand: string("Food brand"),
      servingDescription: string("Serving description"),
      servingSize: string("Serving size (documented string type)"),
    },
    required: ["foodId", "foodName"],
  },
};
const returnedFood: ValueSchema = {
  type: "object", description: "Food and serving related to feedback", additionalProperties: false,
  properties: {
    foodId: integer("Related food ID"),
    servingId: integer("Related serving ID (0 is valid)"),
  },
};

export const toArray = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value];
export const roundTo = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** food.servings.serving is always an array; adds kcal_per_unit and loggable: false for the derived serving "0". */
function foodTransform(response: any) {
  const food = response?.food;
  if (!food) return response;
  const serving = toArray(food.servings?.serving).map((entry: any) => {
    const calories = Number(entry.calories);
    const units = Number(entry.number_of_units);
    return {
      ...entry,
      ...(calories && units && { kcal_per_unit: roundTo(calories / units, KCAL_PER_UNIT_ROUNDING) }),
      ...(entry.serving_id === REFERENCE_SERVING_ID && { loggable: false }),
    };
  });
  return { ...response, food: { ...food, servings: { ...food.servings, serving } } };
}

/** foods.food is always an array. */
function foodsSearchTransform(response: any) {
  if (!response || !("foods" in response)) return response;
  return { ...response, foods: { ...response.foods, food: toArray(response.foods?.food) } };
}

const MACROS = ["calories", "protein", "fat", "carbohydrate"] as const;

/** food_entries.food_entry is always an array; adds totals overall and by_meal. */
function foodEntriesTransform(response: any) {
  if (!response || !("food_entries" in response)) return response;
  const entries = toArray(response.food_entries?.food_entry);
  const sum = (items: any[]) => Object.fromEntries(
    MACROS.map((key) => [key, roundTo(items.reduce((total, item) => total + (Number(item[key]) || 0), 0), ENTRY_ROUNDING)]),
  );
  const byMeal: Record<string, any[]> = {};
  for (const entry of entries) (byMeal[String(entry.meal).toLowerCase()] ??= []).push(entry);
  return {
    ...response,
    food_entries: { ...response.food_entries, food_entry: entries },
    totals: { ...sum(entries), by_meal: Object.fromEntries(Object.entries(byMeal).map(([meal, items]) => [meal, sum(items)])) },
  };
}

/** Adds a YYYY-MM-DD sibling to every *date_int day number (date_int -> date, from_date_int -> from_date). */
export function addIsoDates(value: any): any {
  if (Array.isArray(value)) return value.map(addIsoDates);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = addIsoDates(item);
    if (key.endsWith("date_int") && /^-?\d+$/.test(String(item))) {
      const isoKey = key.slice(0, -"_int".length);
      if (!(isoKey in value)) result[isoKey] = new Date(Number(item) * MS_PER_DAY).toISOString().slice(0, 10);
    }
  }
  return result;
}

/** True when a FatSecret error message carries error code 10 (method not in the plan). */
export const isUnknownMethodError = (message: string) =>
  message.includes(`FatSecret API error: ${UNKNOWN_METHOD_ERROR_CODE} - `);

/** Latest navigation operations, including versioned alternatives to legacy tools.
 * Each docPath is relative to https://platform.fatsecret.com/docs/.
 * Method strings are taken from the parameter tables, not inferred from paths.
 */
export const toolCatalog: Operation[] = [
  {
    docPath: "v1/exercise_entries.commit_day", name: "commit_exercise_day",
    description: "Saves the default exercise entries for the user on a nominated date.",
    method: "exercise_entries.commit_day",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v1/exercise_entries.save_template", name: "save_exercise_template",
    description: "Saves a day's exercise entries as the template for the nominated weekdays (days is a weekday bit mask).",
    method: "exercise_entries.save_template",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("days", integer("The days of the week specified as bits with Sunday being the 1st bit and Saturday being the last and then converted to an Int. For example Tuesday and Thursday would be represented as 00010100 in bits or 20 in Int where Tuesday is the 3rd bit from the right and Thursday being the 5th. Must be between 0 and 128", { minimum: 0, maximum: 128 }), true),
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v1/exercise_entry.edit", name: "update_exercise_entry",
    description: "Records a change to a user's exercise diary entry for a nominated date. All changes to an exercise diary involve either increasing the duration of an existing activity or introducing a new activity for a nominated duration. Because there are always 24 hours worth of exercise entries on any given date, the user must nominate the exercise or activity from which the time was taken to balance out the total duration of activities and exercises for the 24 hour period. As such, each change to the exercise entries on a given day is a \"shifting\" operation where time is moved from one activity to another. An exercise is removed from the day when all of the time allocated to it is shifted to other exercises.",
    method: "exercise_entry.edit",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("shift_to_id", string("ID of the exercise type to shift to (canonical decimal string)", { pattern: "^(0|[1-9]\\d*)$" }), true),
      field("shift_from_id", string("ID of the exercise type to shift from (canonical decimal string)", { pattern: "^(0|[1-9]\\d*)$" }), true),
      field("minutes", integer("Duration in minutes"), true),
      field("date", date(DEFAULT_DAY)),
      field("shift_to_name", string("Only required if shift_to_id is 0 (exercise type \"Other\"). This is the name of the new custom exercise type to shift to")),
      field("shift_from_name", string("Only required if shift_from_id is 0 (exercise type \"Other\"). This is the name of the custom exercise type to shift from")),
      field("kcal", integer("Only required if shift_to_id is 0 (exercise type \"Other\"). This is the total number of kcals burned for this exercise")),
    ],
    conditions: [
      { field: "shiftToId", values: ["0"], required: ["shiftToName", "kcal"] },
      { field: "shiftFromId", values: ["0"], required: ["shiftFromName"] },
    ],
  },
  {
    docPath: "v1/feedback", name: "submit_food_feedback",
    description: "This API method enables developers to submit user feedback regarding potentially incorrect or missing food and/or barcode data. It supports a variety of issue types, including potential food or brand naming errors, incorrect nutrition facts, missing serving sizes, and unrecognized barcodes.  Requires Premier feature access; uses an OAuth1-signed JSON path endpoint.",
    url: "https://platform.fatsecret.com/rest/feedback/v1", json: true,
    httpMethod: "POST", userAuth: false, premier: true, destructive: false,
    fields: [
      field("barcode", string("A barcode where a food is associated incorrectly. Required when issue_type_id is 1", { pattern: "^\\d{13}$" })),
      field("issue_type_id", integer("The type ID for the request. Valid options are 1 (Wrong Name/Brand), 2 (Wrong Nutrition Info), 3 (Missing Serving Size), 4 (Barcode not found), 99 (Other)", { enum: [1, 2, 3, 4, 99] }), true),
      field("issue_type", string("Issue description. This is to be provided when the issue_type_id is 99 (Other)")),
      field("notes", string("Custom notes regarding the issue")),
      field("external_id", string("Custom identifier for external use. E.g an external unique user identifier"), true),
      field("image_file_extension", string("The image file extension in which the signed uploads will be generated using. Accepts jpg, jpeg, png and tiff. Defaulted to jpg if not provided", { enum: ["jpg", "jpeg", "png", "tiff"] })),
      field("region", REGION),
      field("language", LANGUAGE),
      field("returned_food", returnedFood),
    ],
    conditions: [
      { field: "issueTypeId", values: [1], required: ["barcode", "returnedFood.foodId"] },
      { field: "issueTypeId", values: [2, 3], required: ["returnedFood.foodId", "returnedFood.servingId"] },
      { field: "issueTypeId", values: [99], required: ["issueType"] },
    ],
  },
  {
    docPath: "v1/food.add_favorite", name: "add_favorite_food",
    description: "Add a food to a user's favorite according to the parameters specified.",
    method: "food.add_favorite",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("food_id", string("Unique food identifier", { pattern: "^\\d+$" }), true),
      field("serving_id", string("Unique serving identifier", { pattern: "^\\d+$" })),
      field("number_of_units", number(NUMBER_OF_UNITS)),
    ],
  },
  {
    docPath: "v1/food.delete_favorite", name: "delete_favorite_food",
    description: "Deletes the specified food from the user's favorite.",
    method: "food.delete_favorite",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("food_id", string("Unique food identifier", { pattern: "^\\d+$" }), true),
      field("serving_id", string("Unique serving identifier", { pattern: "^\\d+$" })),
      field("number_of_units", number(NUMBER_OF_UNITS)),
    ],
  },
  {
    docPath: "v1/food_entries.copy", name: "copy_food_entries",
    description: "Copies the food entries for a specified meal from a nominated date to a nominated date.",
    method: "food_entries.copy",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("from_date", date("Date to copy food entries from expressed in the number of days since January 1, 1970"), true),
      field("to_date", date("Date to copy food entries to expressed in the number of days since January 1, 1970 (default value is the current day)"), true),
      field("meal", string("Type of meal eaten. Valid meal types are \"breakfast\", \"lunch\", \"dinner\" and \"other\"", { enum: meals })),
    ],
  },
  {
    docPath: "v1/food_entries.copy_saved_meal", name: "copy_saved_meal_to_diary",
    description: "Copies the food entries for a specified saved meal to a specified meal.",
    method: "food_entries.copy_saved_meal",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("saved_meal_id", string("Unique saved meal identifier", { pattern: "^\\d+$" }), true),
      field("meal", string("Type of meal eaten. Valid meal types are \"breakfast\", \"lunch\", \"dinner\" and \"other\"", { enum: meals }), true),
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v1/natural.language.processing", name: "process_natural_language",
    description: "Parses a description of eaten foods into FatSecret food matches and servings. Requires Premier feature access; uses an OAuth1-signed JSON path endpoint.",
    url: "https://platform.fatsecret.com/rest/natural-language-processing/v1", json: true,
    httpMethod: "POST", userAuth: false, premier: true, destructive: false,
    fields: [
      field("user_input", string("A description of what a user has eaten. May contain multiple items. e.g. \"A toast with ham and cheese, an apple, a banana and a cappuccino\". This field is limited to 1000 characters", { maxLength: 1000 }), true),
      field("include_food_data", boolean("Include full food data in the response (see our food.get API)")),
      field("eaten_foods", eatenFoods),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v1/profile.create", name: "create_profile",
    description: "Creates a new profile. Returns sensitive OAuth tokens/secrets; do not share the result. Does not change configured credentials.",
    method: "profile.create",
    httpMethod: "POST", userAuth: false, destructive: false,
    fields: [
      field("user_id", string("You can set your own ID for the newly created profile if you do not wish to store the auth_token and auth_secret"), true),
    ],
  },
  {
    docPath: "v1/profile.get_auth", name: "get_profile_auth",
    description: "Returns the authentication information for a nominated user. Returns sensitive OAuth tokens/secrets; do not share the result. Does not change configured credentials.",
    // The method table says profile.get; use the unambiguous documented auth path.
    url: "https://platform.fatsecret.com/rest/profile/auth/v1",
    httpMethod: "GET", userAuth: false, destructive: false,
    fields: [
      field("user_id", string("You can set your own ID for the newly created profile if you do not wish to store the auth_token and auth_secret")),
    ],
  },
  {
    docPath: "v1/recipe.add_favorite", name: "add_favorite_recipe",
    description: "Add a recipe to a user's favorite.",
    method: "recipe.add_favorite",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("recipe_id", string("Unique recipe identifier", { pattern: "^\\d+$" }), true),
    ],
  },
  {
    docPath: "v1/recipe.delete_favorite", name: "delete_favorite_recipe",
    description: "Deletes the specified recipe from the user's favorite.",
    method: "recipe.delete_favorite",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("recipe_id", string("Unique recipe identifier", { pattern: "^\\d+$" }), true),
    ],
  },
  {
    docPath: "v1/saved_meal.create", name: "create_saved_meal",
    description: "Records a saved meal for the user according to the parameters specified. The result of the call is the new unique identifier of the newly created saved meal.",
    method: "saved_meal.create",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("saved_meal_name", string("New name of the saved meal"), true),
      field("saved_meal_description", string("New description of the saved meal")),
      field("meals", mealList),
    ],
  },
  {
    docPath: "v1/saved_meal.delete", name: "delete_saved_meal",
    description: "Deletes the specified saved meal for the user.",
    method: "saved_meal.delete",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("saved_meal_id", string("Unique saved meal identifier", { pattern: "^\\d+$" }), true),
    ],
  },
  {
    docPath: "v1/saved_meal.edit", name: "update_saved_meal",
    description: "Records a change to a user's saved meal.",
    method: "saved_meal.edit",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("saved_meal_id", string("Unique saved meal identifier", { pattern: "^\\d+$" }), true),
      field("saved_meal_name", string("New name of the saved meal")),
      field("saved_meal_description", string("New description of the saved meal")),
      field("meals", mealList),
    ],
  },
  {
    docPath: "v1/saved_meal_item.add", name: "add_saved_meal_item",
    description: "Adds a food to a user's saved meal according to the parameters specified. The result of the call is the new unique identifier of the newly created saved meal item.",
    method: "saved_meal_item.add",
    httpMethod: "POST", userAuth: true, destructive: false,
    fields: [
      field("saved_meal_id", string("Unique saved meal identifier", { pattern: "^\\d+$" }), true),
      field("food_id", string("Unique food identifier", { pattern: "^\\d+$" }), true),
      field("saved_meal_item_name", string("New name of the saved meal item"), true),
      field("serving_id", string("Unique serving identifier", { pattern: "^\\d+$" }), true),
      field("number_of_units", number(NUMBER_OF_UNITS), true),
    ],
  },
  {
    docPath: "v1/saved_meal_item.delete", name: "delete_saved_meal_item",
    description: "Deletes the specified saved meal item for the user.",
    method: "saved_meal_item.delete",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("saved_meal_item_id", string("Unique saved meal item identifier", { pattern: "^\\d+$" }), true),
    ],
  },
  {
    docPath: "v1/saved_meal_item.edit", name: "update_saved_meal_item",
    description: "Updates a saved meal item's name or number of units; at least one update required. Serving ID cannot be changed.",
    method: "saved_meal_item.edit",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("saved_meal_item_id", string("Unique saved meal item identifier", { pattern: "^\\d+$" }), true),
      field("saved_meal_item_name", string("New name of the saved meal item")),
      field("number_of_units", number(NUMBER_OF_UNITS)),
    ],
    atLeastOne: ["savedMealItemName", "numberOfUnits"],
  },
  {
    docPath: "v1/weight.update", name: "update_weight",
    description: "Records a user's weight for a nominated date. First weigh-in also requires goalWeightKg and currentHeightCm. Not a substitute for medical advice.",
    method: "weight.update",
    httpMethod: "POST", userAuth: true, destructive: true,
    fields: [
      field("current_weight_kg", number("Current weight of the user in kilograms"), true),
      field("date", date(DEFAULT_DAY)),
      field("weight_type", string("Weight measurement type for this user profile. Valid types are \"kg\" and \"lb\" (default value is \"kg\")", { enum: ["kg", "lb"] })),
      field("height_type", string("Height measurement type for this user profile. Valid types are \"cm\" and \"inch\" (default value is \"cm\")", { enum: ["cm", "inch"] })),
      field("goal_weight_kg", number("User's goal weight in kilograms")),
      field("current_height_cm", number("Current height of the user in centimetres. This is required for the first weigh-in. You can only set this for the first time")),
      field("comment", string("A comment for this weigh-in")),
    ],
  },
  {
    docPath: "v2/exercise_entries.get", name: "get_user_exercise_entries",
    description: "Returns the daily exercise entries for the user on a nominated date.",
    method: "exercise_entries.get.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v2/exercise_entries.get_month", name: "get_exercise_month",
    description: "Returns the summary estimated daily calories expended for a user's exercise diary entries for the month specified. Use this call to display total energy expenditure information to users about their exercise and activities for a nominated month. Days with no saved exercise diary entries are not included.",
    method: "exercise_entries.get_month.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v2/exercises.get", name: "get_exercises",
    description: "This is a utility method, returning the full list of all supported exercise type names and their associated unique identifiers.",
    method: "exercises.get.v2",
    httpMethod: "GET", userAuth: false, destructive: false,
    fields: [
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/food.create", name: "create_food",
    description: "Creates a food for the user according to the parameters specified. The result of the call is the new unique identifier of the newly created food.",
    method: "food.create.v2",
    httpMethod: "POST", userAuth: true, premier: true, destructive: false,
    fields: [
      field("brand_type", string("Either \"manufacturer\", \"restaurant\" or \"supermarket\" (default value is \"manufacturer\")", { enum: ["manufacturer", "restaurant", "supermarket"] }), true),
      field("brand_name", string("Brand name, only when food_type is \"Brand\". E.G.: \"Quaker\""), true),
      field("food_name", string("Name of the food, not including the brand name. E.G.: \"Instant Oatmeal\""), true),
      field("serving_size", string("Full description of the serving size. E.G.: \"1 serving\""), true),
      field("calories", number("Energy content in kcal"), true),
      field("fat", number("Total fat content in grams"), true),
      field("carbohydrate", number("Total carbohydrate content in grams"), true),
      field("protein", number("Protein content in grams"), true),
      field("serving_amount", string("The quantity combined with serving_amount_unit to derive the total standardized quantity of the serving")),
      field("serving_amount_unit", string("The metric unit of measure for the serving size – either \"g\" or \"ml\" or \"oz\" – combined with metric_serving_amount to derive the total standardized quantity of the serving (default value is \"g\")", { enum: ["g", "ml", "oz"] })),
      field("calories_from_fat", number("The energy content in kcal from fat")),
      field("saturated_fat", number("Saturated fat content in grams (where available)")),
      field("polyunsaturated_fat", number("Polyunsaturated fat content in grams (where available)")),
      field("monounsaturated_fat", number("Monounsaturated fat content in grams (where available)")),
      field("trans_fat", number("Trans fat content in grams (where available)")),
      field("cholesterol", number("Cholesterol content in milligrams (where available)")),
      field("sodium", number("Sodium content in milligrams (where available)")),
      field("potassium", number("Potassium content in milligrams (where available)")),
      field("fiber", number("Fiber content in grams (where available)")),
      field("sugar", number("Sugar content in grams (where available)")),
      field("added_sugars", number("Added Sugars content in grams (where available)")),
      field("vitamin_d", number("Vitamin D content in micrograms (where available)")),
      field("vitamin_a", number("Vitamin A content in micrograms (where available)")),
      field("vitamin_c", number("Vitamin C content in milligrams (where available)")),
      field("calcium", number("Calcium content in milligrams (where available)")),
      field("iron", number("Iron content in milligrams (where available)")),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/food.find_id_for_barcode", name: "find_food_by_barcode",
    description: "Returns detailed nutritional information for the specified food matching the barcode specified. Barcodes must be specified as GTIN-13 numbers - a 13-digit number filled in with zeros for the spaces to the left. UPC-A, EAN-13 and EAN-8 barcodes may be specified. UPC-E barcodes should be converted to their UPC-A equivalent (and then specified as GTIN-13 numbers).",
    method: "food.find_id_for_barcode.v2",
    httpMethod: "GET", userAuth: false, premier: true, destructive: false,
    fields: [
      field("barcode", string("13-digit GTIN-13 formatted sequence of digits representing the barcode to search against", { pattern: "^\\d{13}$" }), true),
      field("include_sub_categories", boolean(`Response will include the names of all sub categories associated with the food. ${PREMIER_PARAM}`)),
      field("include_food_images", boolean("Response will include food image in the response. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account)")),
      field("include_food_attributes", boolean("Response will include food dietary preferences and allergens if available. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account)")),
      field("flag_default_serving", boolean(`The response flags one serving as the default (the suggested or most commonly chosen option). ${PREMIER_PARAM}`)),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/food_brands.get", name: "get_food_brands",
    description: "This is a utility method, returning the list of food brands.",
    method: "food_brands.get.v2",
    httpMethod: "GET", userAuth: false, premier: true, destructive: false,
    fields: [
      field("starts_with", string("Food brands that begin with the first letter is returned. The \"*\" will return all food brands beginning with a numeric character. If this is not specified then the most popular food brands at the time is returned"), true),
      field("brand_type", string("Either \"manufacturer\", \"restaurant\" or \"supermarket\" (default value is \"manufacturer\")", { enum: ["manufacturer", "restaurant", "supermarket"] })),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/food_categories.get", name: "get_food_categories",
    description: "This is a utility method, returning the full list of all food categories and their associated unique identifiers.",
    method: "food_categories.get.v2",
    httpMethod: "GET", userAuth: false, premier: true, destructive: false,
    fields: [
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/food_entries.get_month", name: "get_food_entries_month",
    description: "Returns summary daily nutritional information for a user's food diary entries for the month specified. Use this call to display nutritional information to users about their food intake for a nominated month. Days with no food diary entries are not included.",
    method: "food_entries.get_month.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v2/food_sub_categories.get", name: "get_food_sub_categories",
    description: "This is a utility method, returning the full list of all food sub categories for a food category.",
    method: "food_sub_categories.get.v2",
    httpMethod: "GET", userAuth: false, premier: true, destructive: false,
    fields: [
      field("food_category_id", string("Unique identifier of the food category entry", { pattern: "^\\d+$" }), true),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/foods.autocomplete", name: "autocomplete_foods",
    description: "Returns food elements best matching the search expression specified, ordered by their relevancy to the search expression.",
    method: "foods.autocomplete.v2",
    httpMethod: "GET", userAuth: false, premier: true, destructive: false,
    fields: [
      field("expression", string("Suggestions for the given expression is returned. E.G.: \"chic\" will return up to four of the best suggestions that contains \"chic\""), true),
      field("max_results", integer("Maximum number of results to return (default value is 4). This number cannot be greater than 10", { minimum: 0, maximum: 10 })),
      field("region", REGION),
    ],
  },
  {
    docPath: "v2/foods.get_favorites", name: "get_favorite_foods",
    description: "Returns the favorite foods for the specified user.",
    method: "foods.get_favorites.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
    ],
  },
  {
    docPath: "v2/foods.get_most_eaten", name: "get_most_eaten_foods",
    description: "Returns the user's most eaten foods, optionally filtered by meal.",
    method: "foods.get_most_eaten.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("meal", string("Type of meal eaten. Valid meal types are \"breakfast\", \"lunch\", \"dinner\" and \"other\"", { enum: meals })),
    ],
  },
  {
    docPath: "v2/foods.get_recently_eaten", name: "get_recently_eaten_foods",
    description: "Returns the user's recently eaten foods, optionally filtered by meal.",
    method: "foods.get_recently_eaten.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("meal", string("Type of meal eaten. Valid meal types are \"breakfast\", \"lunch\", \"dinner\" and \"other\"", { enum: meals })),
    ],
  },
  {
    docPath: "v2/image.recognition", name: "recognize_food_image",
    description: "Identifies foods and portion sizes in a base64 jpg/png/webp image, returning local database matches. Requires Premier feature access; uses an OAuth1-signed JSON path endpoint.",
    url: "https://platform.fatsecret.com/rest/image-recognition/v2", json: true,
    httpMethod: "POST", userAuth: false, premier: true, destructive: false,
    fields: [
      field("image_b64", string("A Base64 image of one or more foods. This field is limited to 999,982 characters", { maxLength: 999982 }), true),
      field("include_food_data", boolean("Include full food data in the response (see our food.get API)")),
      field("eaten_foods", eatenFoods),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/recipe_types.get", name: "get_recipe_types",
    description: "This is a utility method, returning the full list of all supported recipe type names.",
    method: "recipe_types.get.v2",
    httpMethod: "GET", userAuth: false, destructive: false,
    fields: [
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/recipes.get_favorites", name: "get_favorite_recipes",
    description: "Returns the favorite recipes for the specified user.",
    method: "recipes.get_favorites.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
    ],
  },
  {
    docPath: "v2/saved_meal_items.get", name: "get_saved_meal_items",
    description: "Returns saved meal items for a specified saved meal.",
    method: "saved_meal_items.get.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("saved_meal_id", string("Unique saved meal identifier", { pattern: "^\\d+$" }), true),
    ],
  },
  {
    docPath: "v2/saved_meals.get", name: "get_saved_meals",
    description: "Returns saved meals for the specified user.",
    method: "saved_meals.get.v2",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [
      field("meal", string("Type of meal eaten. Valid meal types are \"breakfast\", \"lunch\", \"dinner\" and \"other\"", { enum: meals })),
    ],
  },
  {
    docPath: "v5/food.get", name: "get_food",
    description: "Get a food with its servings. Every serving has number_of_units and measurement_description (the unit one number_of_units is counted in: g, ml, bar, cup, serving...), the nutrition (calories, protein, fat, carbohydrate) for that amount, and kcal_per_unit (calories / number_of_units, the energy of one unit). A serving with loggable: false (serving_id \"0\") is a derived per-100 reference and cannot be logged; use another serving. To log, pass a serving_id and number_of_units to add_food_entry, or just amount + unit.",
    method: "food.get.v5",
    httpMethod: "GET", userAuth: false, transform: foodTransform,
    fields: [
      field("food_id", string("Unique food identifier", { pattern: "^\\d+$" }), true),
      field("include_sub_categories", boolean(`Response will include the names of all sub categories associated with the food. ${PREMIER_PARAM}`)),
      field("include_food_images", boolean("Response will include food image in the response. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account)")),
      field("include_food_attributes", boolean("Response will include food dietary preferences and allergens if available. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account)")),
      field("flag_default_serving", boolean(`The response flags one serving as the default (the suggested or most commonly chosen option). ${PREMIER_PARAM}`)),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v5/foods.search", name: "search_foods_v5",
    description: "Search foods with v5 detailed nutrition, brand/generic filtering, and optional localization/images/attributes. Requires Premier access.",
    method: "foods.search.v5",
    httpMethod: "GET", userAuth: false, premier: true,
    fields: [
      field("search_expression", string("Search expression to match on food names")),
      field("page_number", integer("Zero-based offset into the results for the query", { minimum: 0 })),
      field("max_results", integer("Maximum number of results to return (default value is 20). This number cannot be greater than 50", { minimum: 0, maximum: 50 })),
      field("include_sub_categories", boolean(`Response will include the names of all sub categories associated with the food. ${PREMIER_PARAM}`)),
      field("include_food_images", boolean("Response will include food image in the response. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account)")),
      field("include_food_attributes", boolean("Response will include food dietary preferences and allergens if available. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account)")),
      field("flag_default_serving", boolean(`The response flags one serving as the default (the suggested or most commonly chosen option). ${PREMIER_PARAM}`)),
      field("food_type", string("Restricts search results to a specific type. Valid values are \"none\", \"generic\" or \"brand\". Defaults to \"none\" i.e no filter", { enum: ["none", "generic", "brand"] })),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v2/recipe.get", name: "get_recipe",
    description: "Get recipe v2 details including grams per portion, with optional Premier region localization.",
    method: "recipe.get.v2",
    httpMethod: "GET", userAuth: false,
    fields: [
      field("recipe_id", string("Unique recipe identifier", { pattern: "^\\d+$" }), true),
      field("region", REGION),
    ],
  },
  {
    docPath: "v3/recipes.search", name: "search_recipes",
    description: "Search recipes with v3 recipe-type, image, nutrition/time filters, sorting, and optional Premier region localization.",
    method: "recipes.search.v3",
    httpMethod: "GET", userAuth: false,
    fields: [
      field("recipe_types", { type: "array", description: "This option filters by specified recipe types and should be provided as a comma separated string of recipe type names. The values are provided via the api: Recipe Types Get All Sent as a comma-separated list.", items: string("Recipe type name from get_recipe_types") }),
      field("recipe_types_matchall", boolean("This option will affect recipe type filters. If true, a recipe must match all provided recipe types, if false (default) then recipes matching any of the supplied types will be returned, The values are provided via the api: Recipe Types Get All")),
      field("search_expression", string("Search expression to match on food names")),
      field("must_have_images", boolean("This option will restrict results to recipes with at least one image")),
      field("calories.from", integer("Minimum calories that are contained in the recipe")),
      field("calories.to", integer("Maximum calories that are contained in the recipe")),
      field("carb_percentage.from", integer("Minimum percentage of the calories composed of carbohydrate")),
      field("carb_percentage.to", integer("Maximum percentage of the calories composed of carbohydrate")),
      field("protein_percentage.from", integer("Minimum percentage of the calories composed of protein")),
      field("protein_percentage.to", integer("Maximum percentage of the calories composed of protein")),
      field("fat_percentage.from", integer("Minimum percentage of the calories composed of fat")),
      field("fat_percentage.to", integer("Maximum percentage of the calories composed of fat")),
      field("prep_time.from", integer("Minimum preparation and cook time in minutes required to create the recipe")),
      field("prep_time.to", integer("Maximum preparation and cook time in minutes required to create the recipe")),
      field("page_number", integer("Zero-based offset into the results for the query", { minimum: 0 })),
      field("max_results", integer("Maximum number of results to return (default value is 20). This number cannot be greater than 50", { minimum: 0, maximum: 50 })),
      field("sort_by", string("This option will order results. Valid options include: newest, oldest, caloriesPerServingAscending, caloriesPerServingDescending. When not explicitly set, the ordering will be returned by newest", { enum: ["newest", "oldest", "caloriesPerServingAscending", "caloriesPerServingDescending"] })),
      field("region", REGION),
    ],
  },
  {
    docPath: "v2/food_entries.get", name: "get_user_food_entries",
    description: "Get diary entries for one day (date) or a single entry (foodEntryId). With neither, returns today's entries by UTC date. food_entries.food_entry is always an array ([] for an empty day) and totals holds calories, protein, fat and carbohydrate for the whole result and per meal (by_meal).",
    method: "food_entries.get.v2",
    httpMethod: "GET", userAuth: true, transform: foodEntriesTransform, defaultsToToday: true,
    fields: [
      field("date", date("Default: today in UTC; pass it explicitly to avoid timezone surprises.")),
      field("food_entry_id", string("Unique identifier of the food diary entry", { pattern: "^\\d+$" })),
    ],
  },
  {
    docPath: "v2/weights.get_month", name: "get_weight_month",
    description: "Get monthly weight entries using v2 consistent array formatting. Omitted date defaults to the current day on FatSecret.",
    method: "weights.get_month.v2",
    httpMethod: "GET", userAuth: true,
    fields: [
      field("date", date(DEFAULT_DAY)),
    ],
  },
  {
    docPath: "v1/foods.search", name: "search_foods",
    description: "Search foods by name. This is the only food search available on the Basic plan and it matches English names only. foods.food is always an array ([] for no results).",
    method: "foods.search",
    httpMethod: "GET", userAuth: false, destructive: false, transform: foodsSearchTransform,
    fields: [
      field("search_expression", string("Search term for foods (e.g. \"chicken breast\", \"apple\")"), true),
      field("page_number", integer("Zero-based offset into the results for the query", { minimum: 0 })),
      field("max_results", integer("Maximum number of results to return (default value is 20). This number cannot be greater than 50", { minimum: 0, maximum: 50 })),
      field("generic_description", string(`Basis of the nutrition summary in food_description: "weight" (per 100 g, the default) or "portion" (per default portion). ${PREMIER_PARAM}`, { enum: ["weight", "portion"] })),
      field("region", REGION),
      field("language", LANGUAGE),
    ],
  },
  {
    docPath: "v1/profile.get", name: "get_user_profile",
    description: "Get the authenticated user's profile information.",
    method: "profile.get",
    httpMethod: "GET", userAuth: true, destructive: false,
    fields: [],
  },
];

function requiredSchema(path: string): Record<string, unknown> {
  const [parent, child] = path.split(".");
  return child
    ? { required: [parent], properties: { [parent]: { required: [child] } } }
    : { required: [parent] };
}

export const catalogTools = toolCatalog.map((operation) => ({
  name: operation.name,
  description: (operation.premier ? PREMIER_PREFIX : "") + operation.description,
  inputSchema: {
    type: "object" as const,
    properties: Object.fromEntries(operation.fields.map((f) => [f.name, f.schema])),
    required: operation.fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
    ...(operation.atLeastOne && { anyOf: operation.atLeastOne.map(requiredSchema) }),
    ...(operation.conditions && {
      allOf: operation.conditions.map((condition) => ({
        if: { required: [condition.field], properties: { [condition.field]: { enum: condition.values } } },
        then: { allOf: condition.required.map(requiredSchema) },
      })),
    }),
  },
  annotations: {
    readOnlyHint: operation.httpMethod === "GET" || (operation.json === true && operation.name !== "submit_food_feedback"),
    destructiveHint: !!operation.destructive,
    openWorldHint: true,
  },
}));

const invalid = (message: string): never => {
  throw new McpError(ErrorCode.InvalidParams, message);
};

function validateValue(value: unknown, schema: ValueSchema, path: string): void {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") invalid(`${path} must be a string`);
      if (schema.maxLength !== undefined && Array.from(value as string).length > schema.maxLength) invalid(`${path} is too long`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value as string)) invalid(`${path} has an invalid format`);
      if (schema.format === "date") {
        const timestamp = Date.parse(`${value}T00:00:00Z`);
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
          invalid(`${path} must be a real YYYY-MM-DD date`);
        }
      }
      break;
    case "integer":
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) ||
          schema.type === "integer" && !Number.isSafeInteger(value)) invalid(`${path} must be a finite ${schema.type}`);
      if (schema.minimum !== undefined && (value as number) < schema.minimum) invalid(`${path} is below ${schema.minimum}`);
      if (schema.maximum !== undefined && (value as number) > schema.maximum) invalid(`${path} is above ${schema.maximum}`);
      break;
    case "boolean":
      if (typeof value !== "boolean") invalid(`${path} must be a boolean`);
      break;
    case "array":
      if (!Array.isArray(value)) invalid(`${path} must be an array`);
      for (const [index, item] of (value as unknown[]).entries()) validateValue(item, schema.items!, `${path}[${index}]`);
      break;
    case "object":
      validateObject(value, schema.properties!, schema.required ?? [], path);
      break;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) invalid(`${path} must be one of ${schema.enum.join(", ")}`);
}

function validateObject(value: unknown, properties: Record<string, ValueSchema>, required: string[], path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of required) if (object[key] === undefined) invalid(`${path}.${key} is required`);
  for (const [key, item] of Object.entries(object)) {
    if (!Object.hasOwn(properties, key)) invalid(`Unknown parameter: ${path}.${key}`);
    if (item !== undefined) validateValue(item, properties[key], `${path}.${key}`);
  }
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };

function toSnakeCase(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(toSnakeCase);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), toSnakeCase(v!),
    ]));
  }
  return value;
}

/** Validate at the MCP boundary, then omit absent options and preserve false/zero. */
export function prepareCatalogCall(operation: Operation, args: unknown) {
  const properties = Object.fromEntries(operation.fields.map((f) => [f.name, f.schema]));
  validateObject(args, properties, operation.fields.filter((f) => f.required).map((f) => f.name), operation.name);
  if (operation.atLeastOne && !operation.atLeastOne.some((key) => args[key] !== undefined)) {
    invalid(`At least one field is required: ${operation.atLeastOne.join(", ")}`);
  }
  for (const condition of operation.conditions ?? []) {
    if (!condition.values.includes(args[condition.field] as string | number)) continue;
    for (const path of condition.required) {
      const [parent, child] = path.split(".");
      const value = child ? (args[parent] as Record<string, unknown> | undefined)?.[child] : args[parent];
      if (value === undefined) invalid(`${path} is required when ${condition.field} is ${args[condition.field]}`);
    }
  }
  const params: Record<string, string> = operation.method ? { method: operation.method } : {};
  const body: Record<string, unknown> = {};
  for (const f of operation.fields) {
    const value = args[f.name];
    if (value === undefined) continue;
    if (operation.json) body[f.apiName] = toSnakeCase(value as JsonValue);
    else params[f.apiName] = f.schema.format === "date"
      ? String(Math.floor(Date.parse(`${value}T00:00:00Z`) / MS_PER_DAY))
      : Array.isArray(value) ? value.join(",") : String(value);
  }
  if (operation.defaultsToToday && params.date === undefined && params.food_entry_id === undefined) {
    params.date = String(Math.floor(Date.now() / MS_PER_DAY));
  }
  if (operation.json) {
    const serialized = JSON.stringify(body);
    if (operation.name === "process_natural_language" && Buffer.byteLength(serialized, "utf8") > 1048576 ||
        operation.name === "recognize_food_image" && serialized.length > 1048576) {
      invalid("JSON request exceeds the documented 1MB limit");
    }
  }
  return { params, body };
}
