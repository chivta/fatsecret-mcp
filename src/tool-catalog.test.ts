import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { FATSECRET_API_URL, FatSecretClient } from "./fatsecret.js";
import { dataTools, handleDataTool } from "./tools.js";
import { catalogTools, toolCatalog } from "./tool-catalog.js";

function setup(failure?: Error) {
  const client = new FatSecretClient({
    clientId: "test-client", clientSecret: "test-secret",
    accessToken: "test-token", accessTokenSecret: "test-token-secret",
  });
  const calls: { method: string; url: string; params?: Record<string, string>; body?: Record<string, unknown>; userAuth: boolean }[] = [];
  client.makeApiRequest = async (method, url, params, userAuth = true) => {
    calls.push({ method, url, params, userAuth });
    if (failure) throw failure;
    return { success: true };
  };
  client.makeJsonApiRequest = async (url, body) => {
    calls.push({ method: "POST", url, body, userAuth: false });
    if (failure) throw failure;
    return { success: true };
  };
  return { client, calls };
}

interface Fixture {
  docPath: string;
  name: string;
  method: string;
  httpMethod: string;
  userAuth: boolean;
  json?: boolean;
  required: string[];
  args: Record<string, unknown>;
  expected: Record<string, unknown>;
}

// Independent, static fixtures transcribed from the official parameter tables.
// They include EVERY optional field, with false/0 and epoch dates where applicable.
const fixtures: Fixture[] = [
  {"docPath": "v1/exercise_entries.commit_day", "name": "commit_exercise_day", "method": "exercise_entries.commit_day", "httpMethod": "POST", "userAuth": true, "required": [], "args": {"date": "1970-01-01"}, "expected": {"date": "0"}},
  {"docPath": "v1/exercise_entries.save_template", "name": "save_exercise_template", "method": "exercise_entries.save_template", "httpMethod": "POST", "userAuth": true, "required": ["days"], "args": {"days": 0, "date": "1970-01-01"}, "expected": {"days": "0", "date": "0"}},
  {"docPath": "v1/exercise_entry.edit", "name": "update_exercise_entry", "method": "exercise_entry.edit", "httpMethod": "POST", "userAuth": true, "required": ["shiftToId", "shiftFromId", "minutes"], "args": {"shiftToId": "1", "shiftFromId": "1", "minutes": 0, "date": "1970-01-01", "shiftToName": "test", "shiftFromName": "test", "kcal": 0}, "expected": {"shift_to_id": "1", "shift_from_id": "1", "minutes": "0", "date": "0", "shift_to_name": "test", "shift_from_name": "test", "kcal": "0"}},
  {"docPath": "v1/feedback", "name": "submit_food_feedback", "method": "https://platform.fatsecret.com/rest/feedback/v1", "httpMethod": "POST", "userAuth": false, "required": ["issueTypeId", "externalId"], "args": {"barcode": "0041570054161", "issueTypeId": 1, "issueType": "test", "notes": "test", "externalId": "test", "imageFileExtension": "jpg", "region": "test", "language": "test", "returnedFood": {"foodId": 3032, "servingId": 0}}, "expected": {"barcode": "0041570054161", "issue_type_id": 1, "issue_type": "test", "notes": "test", "external_id": "test", "image_file_extension": "jpg", "region": "test", "language": "test", "returned_food": {"food_id": 3032, "serving_id": 0}}, "json": true},
  {"docPath": "v1/food.add_favorite", "name": "add_favorite_food", "method": "food.add_favorite", "httpMethod": "POST", "userAuth": true, "required": ["foodId"], "args": {"foodId": "1", "servingId": "1", "numberOfUnits": 0}, "expected": {"food_id": "1", "serving_id": "1", "number_of_units": "0"}},
  {"docPath": "v1/food.delete_favorite", "name": "delete_favorite_food", "method": "food.delete_favorite", "httpMethod": "POST", "userAuth": true, "required": ["foodId"], "args": {"foodId": "1", "servingId": "1", "numberOfUnits": 0}, "expected": {"food_id": "1", "serving_id": "1", "number_of_units": "0"}},
  {"docPath": "v1/food_entries.copy", "name": "copy_food_entries", "method": "food_entries.copy", "httpMethod": "POST", "userAuth": true, "required": ["fromDate", "toDate"], "args": {"fromDate": "1970-01-01", "toDate": "1970-01-01", "meal": "breakfast"}, "expected": {"from_date": "0", "to_date": "0", "meal": "breakfast"}},
  {"docPath": "v1/food_entries.copy_saved_meal", "name": "copy_saved_meal_to_diary", "method": "food_entries.copy_saved_meal", "httpMethod": "POST", "userAuth": true, "required": ["savedMealId", "meal"], "args": {"savedMealId": "1", "meal": "breakfast", "date": "1970-01-01"}, "expected": {"saved_meal_id": "1", "meal": "breakfast", "date": "0"}},
  {"docPath": "v1/natural.language.processing", "name": "process_natural_language", "method": "https://platform.fatsecret.com/rest/natural-language-processing/v1", "httpMethod": "POST", "userAuth": false, "required": ["userInput"], "args": {"userInput": "test", "includeFoodData": false, "eatenFoods": [{"foodId": 3092, "foodName": "egg", "foodBrand": "test", "servingDescription": "whole", "servingSize": "1"}], "region": "test", "language": "test"}, "expected": {"user_input": "test", "include_food_data": false, "eaten_foods": [{"food_id": 3092, "food_name": "egg", "food_brand": "test", "serving_description": "whole", "serving_size": "1"}], "region": "test", "language": "test"}, "json": true},
  {"docPath": "v1/profile.create", "name": "create_profile", "method": "profile.create", "httpMethod": "POST", "userAuth": false, "required": ["userId"], "args": {"userId": "test"}, "expected": {"user_id": "test"}},
  {"docPath": "v1/profile.get_auth", "name": "get_profile_auth", "method": "https://platform.fatsecret.com/rest/profile/auth/v1", "httpMethod": "GET", "userAuth": false, "required": [], "args": {"userId": "test"}, "expected": {"user_id": "test"}},
  {"docPath": "v1/recipe.add_favorite", "name": "add_favorite_recipe", "method": "recipe.add_favorite", "httpMethod": "POST", "userAuth": true, "required": ["recipeId"], "args": {"recipeId": "1"}, "expected": {"recipe_id": "1"}},
  {"docPath": "v1/recipe.delete_favorite", "name": "delete_favorite_recipe", "method": "recipe.delete_favorite", "httpMethod": "POST", "userAuth": true, "required": ["recipeId"], "args": {"recipeId": "1"}, "expected": {"recipe_id": "1"}},
  {"docPath": "v1/saved_meal.create", "name": "create_saved_meal", "method": "saved_meal.create", "httpMethod": "POST", "userAuth": true, "required": ["savedMealName"], "args": {"savedMealName": "test", "savedMealDescription": "test", "meals": ["breakfast", "other"]}, "expected": {"saved_meal_name": "test", "saved_meal_description": "test", "meals": "breakfast,other"}},
  {"docPath": "v1/saved_meal.delete", "name": "delete_saved_meal", "method": "saved_meal.delete", "httpMethod": "POST", "userAuth": true, "required": ["savedMealId"], "args": {"savedMealId": "1"}, "expected": {"saved_meal_id": "1"}},
  {"docPath": "v1/saved_meal.edit", "name": "update_saved_meal", "method": "saved_meal.edit", "httpMethod": "POST", "userAuth": true, "required": ["savedMealId"], "args": {"savedMealId": "1", "savedMealName": "test", "savedMealDescription": "test", "meals": ["breakfast", "other"]}, "expected": {"saved_meal_id": "1", "saved_meal_name": "test", "saved_meal_description": "test", "meals": "breakfast,other"}},
  {"docPath": "v1/saved_meal_item.add", "name": "add_saved_meal_item", "method": "saved_meal_item.add", "httpMethod": "POST", "userAuth": true, "required": ["savedMealId", "foodId", "savedMealItemName", "servingId", "numberOfUnits"], "args": {"savedMealId": "1", "foodId": "1", "savedMealItemName": "test", "servingId": "1", "numberOfUnits": 0}, "expected": {"saved_meal_id": "1", "food_id": "1", "saved_meal_item_name": "test", "serving_id": "1", "number_of_units": "0"}},
  {"docPath": "v1/saved_meal_item.delete", "name": "delete_saved_meal_item", "method": "saved_meal_item.delete", "httpMethod": "POST", "userAuth": true, "required": ["savedMealItemId"], "args": {"savedMealItemId": "1"}, "expected": {"saved_meal_item_id": "1"}},
  {"docPath": "v1/saved_meal_item.edit", "name": "update_saved_meal_item", "method": "saved_meal_item.edit", "httpMethod": "POST", "userAuth": true, "required": ["savedMealItemId"], "args": {"savedMealItemId": "1", "savedMealItemName": "test", "numberOfUnits": 0}, "expected": {"saved_meal_item_id": "1", "saved_meal_item_name": "test", "number_of_units": "0"}},
  {"docPath": "v1/weight.update", "name": "update_weight", "method": "weight.update", "httpMethod": "POST", "userAuth": true, "required": ["currentWeightKg"], "args": {"currentWeightKg": 0, "date": "1970-01-01", "weightType": "kg", "heightType": "cm", "goalWeightKg": 0, "currentHeightCm": 0, "comment": "test"}, "expected": {"current_weight_kg": "0", "date": "0", "weight_type": "kg", "height_type": "cm", "goal_weight_kg": "0", "current_height_cm": "0", "comment": "test"}},
  {"docPath": "v2/exercise_entries.get", "name": "get_user_exercise_entries", "method": "exercise_entries.get.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"date": "1970-01-01"}, "expected": {"date": "0"}},
  {"docPath": "v2/exercise_entries.get_month", "name": "get_exercise_month", "method": "exercise_entries.get_month.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"date": "1970-01-01"}, "expected": {"date": "0"}},
  {"docPath": "v2/exercises.get", "name": "get_exercises", "method": "exercises.get.v2", "httpMethod": "GET", "userAuth": false, "required": [], "args": {"region": "test", "language": "test"}, "expected": {"region": "test", "language": "test"}},
  {"docPath": "v2/food.create", "name": "create_food", "method": "food.create.v2", "httpMethod": "POST", "userAuth": true, "required": ["brandType", "brandName", "foodName", "servingSize", "calories", "fat", "carbohydrate", "protein"], "args": {"brandType": "manufacturer", "brandName": "test", "foodName": "test", "servingSize": "test", "calories": 0, "fat": 0, "carbohydrate": 0, "protein": 0, "servingAmount": "test", "servingAmountUnit": "g", "caloriesFromFat": 0, "saturatedFat": 0, "polyunsaturatedFat": 0, "monounsaturatedFat": 0, "transFat": 0, "cholesterol": 0, "sodium": 0, "potassium": 0, "fiber": 0, "sugar": 0, "addedSugars": 0, "vitaminD": 0, "vitaminA": 0, "vitaminC": 0, "calcium": 0, "iron": 0, "region": "test", "language": "test"}, "expected": {"brand_type": "manufacturer", "brand_name": "test", "food_name": "test", "serving_size": "test", "calories": "0", "fat": "0", "carbohydrate": "0", "protein": "0", "serving_amount": "test", "serving_amount_unit": "g", "calories_from_fat": "0", "saturated_fat": "0", "polyunsaturated_fat": "0", "monounsaturated_fat": "0", "trans_fat": "0", "cholesterol": "0", "sodium": "0", "potassium": "0", "fiber": "0", "sugar": "0", "added_sugars": "0", "vitamin_d": "0", "vitamin_a": "0", "vitamin_c": "0", "calcium": "0", "iron": "0", "region": "test", "language": "test"}},
  {"docPath": "v2/food.find_id_for_barcode", "name": "find_food_by_barcode", "method": "food.find_id_for_barcode.v2", "httpMethod": "GET", "userAuth": false, "required": ["barcode"], "args": {"barcode": "0041570054161", "includeSubCategories": false, "includeFoodImages": false, "includeFoodAttributes": false, "flagDefaultServing": false, "region": "test", "language": "test"}, "expected": {"barcode": "0041570054161", "include_sub_categories": "false", "include_food_images": "false", "include_food_attributes": "false", "flag_default_serving": "false", "region": "test", "language": "test"}},
  {"docPath": "v2/food_brands.get", "name": "get_food_brands", "method": "food_brands.get.v2", "httpMethod": "GET", "userAuth": false, "required": ["startsWith"], "args": {"startsWith": "test", "brandType": "manufacturer", "region": "test", "language": "test"}, "expected": {"starts_with": "test", "brand_type": "manufacturer", "region": "test", "language": "test"}},
  {"docPath": "v2/food_categories.get", "name": "get_food_categories", "method": "food_categories.get.v2", "httpMethod": "GET", "userAuth": false, "required": [], "args": {"region": "test", "language": "test"}, "expected": {"region": "test", "language": "test"}},
  {"docPath": "v2/food_entries.get_month", "name": "get_food_entries_month", "method": "food_entries.get_month.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"date": "1970-01-01"}, "expected": {"date": "0"}},
  {"docPath": "v2/food_sub_categories.get", "name": "get_food_sub_categories", "method": "food_sub_categories.get.v2", "httpMethod": "GET", "userAuth": false, "required": ["foodCategoryId"], "args": {"foodCategoryId": "1", "region": "test", "language": "test"}, "expected": {"food_category_id": "1", "region": "test", "language": "test"}},
  {"docPath": "v2/foods.autocomplete", "name": "autocomplete_foods", "method": "foods.autocomplete.v2", "httpMethod": "GET", "userAuth": false, "required": ["expression"], "args": {"expression": "test", "maxResults": 0, "region": "test"}, "expected": {"expression": "test", "max_results": "0", "region": "test"}},
  {"docPath": "v2/foods.get_favorites", "name": "get_favorite_foods", "method": "foods.get_favorites.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {}, "expected": {}},
  {"docPath": "v2/foods.get_most_eaten", "name": "get_most_eaten_foods", "method": "foods.get_most_eaten.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"meal": "breakfast"}, "expected": {"meal": "breakfast"}},
  {"docPath": "v2/foods.get_recently_eaten", "name": "get_recently_eaten_foods", "method": "foods.get_recently_eaten.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"meal": "breakfast"}, "expected": {"meal": "breakfast"}},
  {"docPath": "v2/image.recognition", "name": "recognize_food_image", "method": "https://platform.fatsecret.com/rest/image-recognition/v2", "httpMethod": "POST", "userAuth": false, "required": ["imageB64"], "args": {"imageB64": "test", "includeFoodData": false, "eatenFoods": [{"foodId": 3092, "foodName": "egg", "foodBrand": "test", "servingDescription": "whole", "servingSize": "1"}], "region": "test", "language": "test"}, "expected": {"image_b64": "test", "include_food_data": false, "eaten_foods": [{"food_id": 3092, "food_name": "egg", "food_brand": "test", "serving_description": "whole", "serving_size": "1"}], "region": "test", "language": "test"}, "json": true},
  {"docPath": "v2/recipe_types.get", "name": "get_recipe_types", "method": "recipe_types.get.v2", "httpMethod": "GET", "userAuth": false, "required": [], "args": {"region": "test", "language": "test"}, "expected": {"region": "test", "language": "test"}},
  {"docPath": "v2/recipes.get_favorites", "name": "get_favorite_recipes", "method": "recipes.get_favorites.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {}, "expected": {}},
  {"docPath": "v2/saved_meal_items.get", "name": "get_saved_meal_items", "method": "saved_meal_items.get.v2", "httpMethod": "GET", "userAuth": true, "required": ["savedMealId"], "args": {"savedMealId": "1"}, "expected": {"saved_meal_id": "1"}},
  {"docPath": "v2/saved_meals.get", "name": "get_saved_meals", "method": "saved_meals.get.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"meal": "breakfast"}, "expected": {"meal": "breakfast"}},
  {"docPath": "v5/food.get", "name": "get_food", "method": "food.get.v5", "httpMethod": "GET", "userAuth": false, "required": ["foodId"], "args": {"foodId": "1", "includeSubCategories": false, "includeFoodImages": false, "includeFoodAttributes": false, "flagDefaultServing": false, "region": "test", "language": "test"}, "expected": {"food_id": "1", "include_sub_categories": "false", "include_food_images": "false", "include_food_attributes": "false", "flag_default_serving": "false", "region": "test", "language": "test"}},
  {"docPath": "v5/foods.search", "name": "search_foods_v5", "method": "foods.search.v5", "httpMethod": "GET", "userAuth": false, "required": [], "args": {"searchExpression": "test", "pageNumber": 0, "maxResults": 0, "includeSubCategories": false, "includeFoodImages": false, "includeFoodAttributes": false, "flagDefaultServing": false, "foodType": "brand", "region": "test", "language": "test"}, "expected": {"search_expression": "test", "page_number": "0", "max_results": "0", "include_sub_categories": "false", "include_food_images": "false", "include_food_attributes": "false", "flag_default_serving": "false", "food_type": "brand", "region": "test", "language": "test"}},
  {"docPath": "v2/recipe.get", "name": "get_recipe", "method": "recipe.get.v2", "httpMethod": "GET", "userAuth": false, "required": ["recipeId"], "args": {"recipeId": "1", "region": "test"}, "expected": {"recipe_id": "1", "region": "test"}},
  {"docPath": "v3/recipes.search", "name": "search_recipes", "method": "recipes.search.v3", "httpMethod": "GET", "userAuth": false, "required": [], "args": {"recipeTypes": ["Main Dish", "Soup"], "recipeTypesMatchall": false, "searchExpression": "test", "mustHaveImages": false, "caloriesFrom": 0, "caloriesTo": 0, "carbPercentageFrom": 0, "carbPercentageTo": 0, "proteinPercentageFrom": 0, "proteinPercentageTo": 0, "fatPercentageFrom": 0, "fatPercentageTo": 0, "prepTimeFrom": 0, "prepTimeTo": 0, "pageNumber": 0, "maxResults": 0, "sortBy": "caloriesPerServingAscending", "region": "test"}, "expected": {"recipe_types": "Main Dish,Soup", "recipe_types_matchall": "false", "search_expression": "test", "must_have_images": "false", "calories.from": "0", "calories.to": "0", "carb_percentage.from": "0", "carb_percentage.to": "0", "protein_percentage.from": "0", "protein_percentage.to": "0", "fat_percentage.from": "0", "fat_percentage.to": "0", "prep_time.from": "0", "prep_time.to": "0", "page_number": "0", "max_results": "0", "sort_by": "caloriesPerServingAscending", "region": "test"}},
  {"docPath": "v2/food_entries.get", "name": "get_user_food_entries", "method": "food_entries.get.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"date": "1970-01-01", "foodEntryId": "1"}, "expected": {"date": "0", "food_entry_id": "1"}},
  {"docPath": "v2/weights.get_month", "name": "get_weight_month", "method": "weights.get_month.v2", "httpMethod": "GET", "userAuth": true, "required": [], "args": {"date": "1970-01-01"}, "expected": {"date": "0"}},
  {"docPath": "v1/foods.search", "name": "search_foods", "method": "foods.search", "httpMethod": "GET", "userAuth": false, "required": ["searchExpression"], "args": {"searchExpression": "test", "pageNumber": 0, "maxResults": 0, "genericDescription": "weight", "region": "UA", "language": "uk"}, "expected": {"search_expression": "test", "page_number": "0", "max_results": "0", "generic_description": "weight", "region": "UA", "language": "uk"}},
  {"docPath": "v1/profile.get", "name": "get_user_profile", "method": "profile.get", "httpMethod": "GET", "userAuth": true, "required": [], "args": {}, "expected": {}},
];

test("tool catalog covers every catalog navigation operation exactly once", () => {
  assert.equal(fixtures.length, 46);
  assert.deepEqual(toolCatalog.map((op) => [op.docPath, op.name]), fixtures.map((f) => [f.docPath, f.name]));
  assert.equal(new Set(dataTools.map((t) => t.name)).size, dataTools.length);
  assert.equal(new Set(toolCatalog.map((t) => t.docPath)).size, 46);
  assert.equal(dataTools.length, 50); // 46 catalog operations + add/update/delete_food_entry + check_auth_status
  assert.deepEqual(dataTools.slice(-46), catalogTools);
  const currentOperationPaths = ["v1/exercise_entries.commit_day", "v1/exercise_entries.save_template", "v1/exercise_entry.edit", "v1/feedback", "v1/food.add_favorite", "v1/food.delete_favorite", "v1/food_entries.copy", "v1/food_entries.copy_saved_meal", "v1/food_entry.create", "v1/food_entry.delete", "v1/food_entry.edit", "v1/foods.search", "v1/natural.language.processing", "v1/profile.create", "v1/profile.get", "v1/profile.get_auth", "v1/recipe.add_favorite", "v1/recipe.delete_favorite", "v1/saved_meal.create", "v1/saved_meal.delete", "v1/saved_meal.edit", "v1/saved_meal_item.add", "v1/saved_meal_item.delete", "v1/saved_meal_item.edit", "v1/weight.update", "v2/exercise_entries.get", "v2/exercise_entries.get_month", "v2/exercises.get", "v2/food.create", "v2/food.find_id_for_barcode", "v2/food_brands.get", "v2/food_categories.get", "v2/food_entries.get", "v2/food_entries.get_month", "v2/food_sub_categories.get", "v2/foods.autocomplete", "v2/foods.get_favorites", "v2/foods.get_most_eaten", "v2/foods.get_recently_eaten", "v2/image.recognition", "v2/recipe.get", "v2/recipe_types.get", "v2/recipes.get_favorites", "v2/saved_meal_items.get", "v2/saved_meals.get", "v2/weights.get_month", "v3/recipes.search", "v5/food.get", "v5/foods.search"];
  assert.deepEqual([...toolCatalog.map((op) => op.docPath), "v1/food_entry.create", "v1/food_entry.edit", "v1/food_entry.delete"].sort(), currentOperationPaths);
  for (const tool of catalogTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
      assert.match(name, /^[a-z][a-zA-Z0-9]*$/);
      assert.ok(schema.description.length > 0);
    }
    assert.equal(tool.annotations.destructiveHint, /^(delete|update|save)_/.test(tool.name));
    assert.equal(tool.annotations.readOnlyHint, /^(get|find|autocomplete|process|recognize|search)_/.test(tool.name));
  }
});

for (const fixture of fixtures) {
  test(`${fixture.docPath}: ${fixture.name} maps all fields, correct method/auth and JSON result`, async () => {
    const { client, calls } = setup();
    const tool = catalogTools.find((t) => t.name === fixture.name)!;
    assert.deepEqual(tool.inputSchema.required, fixture.required);
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), Object.keys(fixture.args).sort());
    const result = await handleDataTool(client, fixture.name, fixture.args);
    assert.deepEqual(result, { content: [{ type: "text", text: '{\n  "success": true\n}' }] });
    const url = fixture.method.startsWith("https:") ? fixture.method : FATSECRET_API_URL;
    assert.deepEqual(calls, [{
      method: fixture.httpMethod, url, userAuth: fixture.userAuth,
      ...(fixture.json ? { body: fixture.expected } : {
        params: { ...(url === FATSECRET_API_URL && { method: fixture.method }), ...fixture.expected, format: "json" },
      }),
    }]);
  });

  test(`${fixture.name} rejects each missing required field and wrong boundary types`, async () => {
    const { client, calls } = setup();
    for (const field of fixture.required) {
      const args = { ...fixture.args };
      delete args[field];
      await assert.rejects(handleDataTool(client, fixture.name, args), { code: ErrorCode.InvalidParams });
    }
    for (const invalid of [null, [], "invalid", { ...fixture.args, unexpected: true }]) {
      await assert.rejects(handleDataTool(client, fixture.name, invalid), { code: ErrorCode.InvalidParams });
    }
    for (const field of Object.keys(fixture.args)) {
      await assert.rejects(handleDataTool(client, fixture.name, { ...fixture.args, [field]: null }), { code: ErrorCode.InvalidParams });
    }
    assert.equal(calls.length, 0);
  });

  test(`${fixture.name} omits absent optional params (including dates)`, async () => {
    const { client, calls } = setup();
    const args = Object.fromEntries(fixture.required.map((key) => [key, fixture.args[key]]));
    if (fixture.name === "update_saved_meal_item") args.numberOfUnits = 0;
    if (fixture.name === "submit_food_feedback") args.issueTypeId = 4;
    if (fixture.name === "get_user_food_entries") args.foodEntryId = "1";
    // Explicit undefined options are also absent, never strings like "undefined".
    for (const key of Object.keys(fixture.args)) if (!(key in args)) args[key] = undefined;
    await handleDataTool(client, fixture.name, args);
    const sent = calls[0].body ?? calls[0].params!;
    const wireKeys = Object.keys(fixture.expected).filter((wireKey) => args[wireKey.replace(/[_.]([a-z])/g, (_, letter: string) => letter.toUpperCase())] !== undefined);
    assert.deepEqual(Object.keys(sent).sort(), [...wireKeys, ...(fixture.json ? [] : ["format", ...(fixture.method.startsWith("https:") ? [] : ["method"])])].sort());
  });

  test(`${fixture.name} enforces auth and wraps API errors`, async () => {
    for (const missing of fixture.userAuth ? ["accessToken", "accessTokenSecret"] as const : ["clientId", "clientSecret"] as const) {
      const { client, calls } = setup();
      client.config[missing] = "";
      await assert.rejects(handleDataTool(client, fixture.name, fixture.args), { code: ErrorCode.InvalidRequest });
      assert.equal(calls.length, 0);
    }
    if (!fixture.userAuth) {
      const { client, calls } = setup();
      client.config.accessToken = undefined;
      client.config.accessTokenSecret = undefined;
      await handleDataTool(client, fixture.name, fixture.args);
      assert.equal(calls[0].userAuth, false);
    }
    const { client } = setup(new Error("upstream failure"));
    await assert.rejects(handleDataTool(client, fixture.name, fixture.args), (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, ErrorCode.InternalError);
      assert.ok(error.message.includes(`Failed to ${fixture.name.replace(/_/g, " ")}: upstream failure`));
      return true;
    });
  });
}

test("calendar dates are validated and converted at UTC, without timezone rollover", async () => {
  const { client, calls } = setup();
  for (const date of ["2024-02-29", "1969-12-31", "1970-01-02"]) {
    await handleDataTool(client, "get_user_exercise_entries", { date });
  }
  assert.deepEqual(calls.map((c) => c.params!.date), ["19782", "-1", "1"]);
  for (const date of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-2-1", "2024-01-01T00:00:00Z", "", "nonsense", 0]) {
    await assert.rejects(handleDataTool(client, "get_user_exercise_entries", { date }), { code: ErrorCode.InvalidParams });
  }
  assert.equal(calls.length, 3);
});

test("enums, numeric bounds, arrays, and nested objects are validated", async () => {
  const { client, calls } = setup();
  for (const [name, args] of [
    ["get_saved_meals", { meal: "snack" }],
    ["create_saved_meal", { savedMealName: "meal", meals: "breakfast,lunch" }],
    ["create_saved_meal", { savedMealName: "meal", meals: ["snack"] }],
    ["autocomplete_foods", { expression: "egg", maxResults: 11 }],
    ["autocomplete_foods", { expression: "egg", maxResults: 1.5 }],
    ["save_exercise_template", { days: -1 }],
    ["save_exercise_template", { days: 129 }],
    ["update_weight", { currentWeightKg: Infinity }],
    ["update_weight", { currentWeightKg: NaN }],
    ["find_food_by_barcode", { barcode: "123" }],
    ["find_food_by_barcode", { barcode: "0041570054161", flagDefaultServing: "false" }],
    ["process_natural_language", { userInput: "egg", eatenFoods: [{}] }],
    ["process_natural_language", { userInput: "egg", eatenFoods: [{ foodId: 1, foodName: "egg", unknown: 1 }] }],
    ["process_natural_language", { userInput: "egg", eatenFoods: [{ foodId: "1", foodName: "egg" }] }],
    ["process_natural_language", { userInput: "x".repeat(1001) }],
    ["recognize_food_image", { imageB64: "x".repeat(999983) }],
  ] as const) await assert.rejects(handleDataTool(client, name, args), { code: ErrorCode.InvalidParams });
  assert.equal(calls.length, 0);
  await handleDataTool(client, "create_saved_meal", { savedMealName: "meal", meals: [] });
  assert.equal(calls[0].params!.meals, "");
  await handleDataTool(client, "process_natural_language", { userInput: "egg", eatenFoods: [], includeFoodData: false });
  assert.deepEqual(calls[1].body, { user_input: "egg", eaten_foods: [], include_food_data: false });
});

test("exercise custom types and saved item edits enforce conditional requirements", async () => {
  const { client, calls } = setup();
  for (const args of [
    { shiftToId: "0", shiftFromId: "1", minutes: 0 },
    { shiftToId: "0", shiftFromId: "1", minutes: 0, shiftToName: "other" },
    { shiftToId: "1", shiftFromId: "0", minutes: 0 },
  ]) await assert.rejects(handleDataTool(client, "update_exercise_entry", args), { code: ErrorCode.InvalidParams });
  await assert.rejects(handleDataTool(client, "update_saved_meal_item", { savedMealItemId: "1" }), { code: ErrorCode.InvalidParams });
  assert.equal(calls.length, 0);
  await handleDataTool(client, "update_exercise_entry", { shiftToId: "0", shiftFromId: "0", minutes: 0, shiftToName: "cycling", shiftFromName: "resting", kcal: 0 });
  assert.equal(calls[0].params!.kcal, "0");
});

test("feedback validates issue-specific fields and permits serving ID zero", async () => {
  const { client, calls } = setup();
  for (const args of [
    { issueTypeId: 1, externalId: "user" },
    { issueTypeId: 1, externalId: "user", barcode: "0041570054161" },
    { issueTypeId: 2, externalId: "user", returnedFood: { foodId: 1 } },
    { issueTypeId: 3, externalId: "user", returnedFood: { servingId: 0 } },
    { issueTypeId: 99, externalId: "user" },
    { issueTypeId: 5, externalId: "user" },
  ]) await assert.rejects(handleDataTool(client, "submit_food_feedback", args), { code: ErrorCode.InvalidParams });
  assert.equal(calls.length, 0);
  await handleDataTool(client, "submit_food_feedback", { issueTypeId: 2, externalId: "user", returnedFood: { foodId: 1, servingId: 0 } });
  assert.deepEqual(calls[0].body, { issue_type_id: 2, external_id: "user", returned_food: { food_id: 1, serving_id: 0 } });
});

test("JSON operations enforce total request limits", async () => {
  const { client, calls } = setup();
  const eatenFoods = [{ foodId: 1, foodName: "x".repeat(1048576) }];
  await assert.rejects(handleDataTool(client, "process_natural_language", { userInput: "egg", eatenFoods }), { code: ErrorCode.InvalidParams });
  await assert.rejects(handleDataTool(client, "recognize_food_image", { imageB64: "eA==", eatenFoods }), { code: ErrorCode.InvalidParams });
  assert.equal(calls.length, 0);
});

test("unknown names still return MethodNotFound", async () => {
  const { client, calls } = setup();
  await assert.rejects(handleDataTool(client, "missing_tool"), { code: ErrorCode.MethodNotFound });
  assert.equal(calls.length, 0);
});

test("food entry lookup accepts date or ID, omitting the other field, and defaults to today's UTC date", async () => {
  const { client, calls } = setup();
  const schema = catalogTools.find((tool) => tool.name === "get_user_food_entries")!.inputSchema;
  assert.deepEqual(schema.required, []);
  assert.equal("anyOf" in schema, false);
  await handleDataTool(client, "get_user_food_entries", { date: "1970-01-01" });
  await handleDataTool(client, "get_user_food_entries", { foodEntryId: "123" });
  await handleDataTool(client, "get_user_food_entries", {});
  await handleDataTool(client, "get_user_food_entries", { date: undefined, foodEntryId: undefined });
  const today = Math.floor(Date.now() / 86400000);
  assert.deepEqual(calls.slice(0, 2).map((call) => call.params), [
    { method: "food_entries.get.v2", date: "0", format: "json" },
    { method: "food_entries.get.v2", food_entry_id: "123", format: "json" },
  ]);
  for (const call of calls.slice(2)) {
    assert.ok(Math.abs(Number(call.params!.date) - today) <= 1);
  }
});

test("exercise shift IDs reject noncanonical decimals before custom requirements can be bypassed", async () => {
  const { client, calls } = setup();
  const schema = catalogTools.find((tool) => tool.name === "update_exercise_entry")!.inputSchema;
  for (const key of ["shiftToId", "shiftFromId"]) {
    assert.equal(schema.properties[key].pattern, "^(0|[1-9]\\d*)$");
    for (const value of ["00", "01", "000", "-0", "+0", "0.0", " 0"]) {
      await assert.rejects(handleDataTool(client, "update_exercise_entry", {
        shiftToId: "1", shiftFromId: "1", minutes: 10, [key]: value,
      }), { code: ErrorCode.InvalidParams });
    }
  }
  assert.equal(calls.length, 0);
});

test("catalog maxLength counts Unicode code points, matching the published schema", async () => {
  const { client, calls } = setup();
  const schema = catalogTools.find((tool) => tool.name === "process_natural_language")!.inputSchema;
  assert.equal(schema.properties.userInput.maxLength, 1000);
  for (const count of [501, 1000]) {
    const userInput = "🍎".repeat(count);
    assert.equal(Array.from(userInput).length, count);
    assert.equal(userInput.length, count * 2);
    await handleDataTool(client, "process_natural_language", { userInput });
    assert.equal(calls.at(-1)!.body!.user_input, userInput);
  }
  await assert.rejects(handleDataTool(client, "process_natural_language", { userInput: "🍎".repeat(1001) }), { code: ErrorCode.InvalidParams });
  assert.equal(calls.length, 2);
});

test("latest food/recipe filters validate enums, ranges, and recipe type arrays", async () => {
  const { client, calls } = setup();
  for (const [name, args] of [
    ["search_foods_v5", { foodType: "restaurant" }],
    ["search_foods_v5", { maxResults: 51 }],
    ["search_foods_v5", { pageNumber: -1 }],
    ["search_recipes", { recipeTypes: "Soup" }],
    ["search_recipes", { recipeTypes: [1] }],
    ["search_recipes", { recipeTypesMatchall: "false" }],
    ["search_recipes", { caloriesFrom: "0" }],
    ["search_recipes", { prepTimeTo: 1.5 }],
    ["search_recipes", { sortBy: "popular" }],
    ["search_recipes", { maxResults: 51 }],
    ["get_food", { foodId: "1", includeFoodAttributes: 1 }],
  ] as const) await assert.rejects(handleDataTool(client, name, args), { code: ErrorCode.InvalidParams });
  assert.equal(calls.length, 0);
  await handleDataTool(client, "search_recipes", { recipeTypes: [], recipeTypesMatchall: false, caloriesFrom: 0, maxResults: 50 });
  assert.deepEqual(calls[0].params, {
    method: "recipes.search.v3", recipe_types: "", recipe_types_matchall: "false", "calories.from": "0", max_results: "50", format: "json",
  });
  for (const foodType of ["none", "generic", "brand"]) {
    await handleDataTool(client, "search_foods_v5", { foodType });
    assert.equal(calls.at(-1)!.params!.food_type, foodType);
  }
});
