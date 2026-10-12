import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { FATSECRET_API_URL, FatSecretClient } from "./fatsecret.js";
import { dataTools, handleDataTool } from "./tools.js";

type Call = {
  method: string;
  url: string;
  params: Record<string, string>;
  userAuth: boolean;
};
type Responder = (params: Record<string, string>) => unknown;

/** Client with a stubbed makeApiRequest; `respond` picks the answer per FatSecret method, or throws. */
function setup(respond: Responder | Error = () => ({ success: { value: "1" } })) {
  const client = new FatSecretClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
    accessTokenSecret: "access-token-secret",
  });
  const calls: Call[] = [];
  client.makeApiRequest = async (method, url, params = {}, userAuth = true) => {
    calls.push({ method, url, params, userAuth });
    if (respond instanceof Error) throw respond;
    return respond(params);
  };
  const writes = () => calls.filter((c) => c.method === "POST");
  return { client, calls, writes };
}

const OATS_SERVING = {
  serving_id: "51966", serving_description: "100 g", metric_serving_amount: "100.000",
  metric_serving_unit: "g", number_of_units: "100.000", measurement_description: "g", calories: "354",
};
const BAR_SERVING = {
  serving_id: "3813024", serving_description: "1 bar", metric_serving_amount: "52.000",
  metric_serving_unit: "g", number_of_units: "1.000", measurement_description: "serving", calories: "240",
};
const REFERENCE_SERVING = { ...OATS_SERVING, serving_id: "0" };
const MILK_SERVING = {
  serving_id: "1136448", serving_description: "100 ml", metric_serving_amount: "103.133",
  metric_serving_unit: "g", number_of_units: "100.000", measurement_description: "ml", calories: "43",
};
const foods: Record<string, unknown> = {
  "3286": { food: { food_id: "3286", food_name: "Oats", servings: { serving: [OATS_SERVING] } } },
  "777": { food: { food_id: "777", food_name: "Bar", servings: { serving: [REFERENCE_SERVING, BAR_SERVING] } } },
  "803": { food: { food_id: "803", food_name: "Milk", servings: { serving: [REFERENCE_SERVING, MILK_SERVING] } } },
};
const ENTRY = {
  food_entry_id: "99", food_entry_description: "60 g Oats", food_entry_name: "Oats", calories: "212",
  protein: "11.85", fat: "1.69", carbohydrate: "37.37", meal: "Breakfast", date_int: "20738",
  food_id: "3286", serving_id: "51966", number_of_units: "60.000",
};

/** Answers food.get.v5, food_entry.create/edit and food_entries.get.v2 like the live API; `override` wins. */
function diary(override: Responder = () => undefined): Responder {
  return (params) => {
    const custom = override(params);
    if (custom !== undefined) return custom;
    switch (params.method) {
      case "food.get.v5":
        return foods[params.food_id];
      case "food_entry.create":
        return { food_entry_id: { value: "99" } };
      case "food_entry.edit":
        return { success: { value: "1" } };
      case "food_entries.get.v2":
        return { food_entries: { food_entry: ENTRY } };
      default:
        throw new Error(`unexpected ${params.method}`);
    }
  };
}

const fail = (code: number, message: string) =>
  new Error(`FatSecret API error: ${code} - ${message}`);
const rejectsInvalid = (promise: Promise<unknown>) =>
  assert.rejects(promise, (e: unknown) => e instanceof McpError && e.code === ErrorCode.InvalidParams);
const text = (result: { content: { text: string }[] }) => result.content[0].text;

test("food-entry tools publish annotations and the renamed arguments", () => {
  const byName = (name: string) => dataTools.find((tool) => tool.name === name)!;
  assert.deepEqual(byName("add_food_entry").annotations, { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(byName("update_food_entry").annotations, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(byName("delete_food_entry").annotations, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(byName("check_auth_status").annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  const add = byName("add_food_entry").inputSchema as any;
  assert.deepEqual(add.required, ["foodId", "meal"]);
  assert.equal(add.additionalProperties, false);
  assert.deepEqual(Object.keys(add.properties).sort(), ["amount", "date", "foodEntryName", "foodId", "force", "meal", "numberOfUnits", "servingId", "unit"]);
  const update = byName("update_food_entry").inputSchema as any;
  assert.deepEqual(update.required, ["foodEntryId"]);
  assert.deepEqual(Object.keys(update.properties).sort(), ["foodEntryId", "foodEntryName", "force", "meal", "numberOfUnits", "servingId"]);
  assert.equal(new Set(dataTools.map((t) => t.name)).size, dataTools.length);
});

test("add_food_entry logs numberOfUnits 60 on the 100 g serving and returns the read-back entry", async () => {
  const { client, calls } = setup(diary());
  const result = await handleDataTool(client, "add_food_entry", {
    foodId: "3286", servingId: "51966", numberOfUnits: 60, meal: "breakfast", date: "1970-01-01",
  });
  assert.deepEqual(calls.map((c) => [c.params.method, c.userAuth]), [
    ["food.get.v5", false], ["food_entry.create", true], ["food_entries.get.v2", true],
  ]);
  assert.deepEqual(calls[1].params, {
    method: "food_entry.create", food_id: "3286", food_entry_name: "Oats", serving_id: "51966",
    number_of_units: "60", meal: "breakfast", date: "0", format: "json",
  });
  assert.equal(calls[2].params.food_entry_id, "99");
  assert.ok(text(result).startsWith("Food entry added successfully!\n\n"));
  const entry = JSON.parse(text(result).split("\n\n")[1]);
  assert.equal(entry.food_entry_description, "60 g Oats");
  assert.equal(entry.calories, "212");
  assert.equal(entry.date, "2026-10-12");
});

test("add_food_entry rejects 0.6 on a g serving without writing, and sends it with force", async () => {
  const { client, calls, writes } = setup(diary());
  const args = { foodId: "3286", servingId: "51966", numberOfUnits: 0.6, meal: "lunch" };
  await assert.rejects(handleDataTool(client, "add_food_entry", args), (e: unknown) => {
    assert.ok(e instanceof McpError);
    assert.equal(e.code, ErrorCode.InvalidParams);
    assert.ok(e.message.includes('numberOfUnits counts g on serving "100 g", so 0.6 logs 0.6 g (about 2 kcal). For 60 g pass 60. Pass force: true only if 0.6 g is really intended.'));
    return true;
  });
  assert.equal(writes().length, 0);
  await handleDataTool(client, "add_food_entry", { ...args, force: true });
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].params.number_of_units, "0.6");
  assert.ok(calls.length > 0);
});

test("add_food_entry converts amount + unit to a serving", async () => {
  const bar = setup(diary());
  await handleDataTool(bar.client, "add_food_entry", { foodId: "777", amount: 60, unit: "g", meal: "other" });
  assert.equal(bar.writes()[0].params.serving_id, "3813024");
  assert.equal(bar.writes()[0].params.number_of_units, "1.154");
  assert.equal(bar.writes()[0].params.food_entry_name, "Bar");

  const milk = setup(diary());
  await handleDataTool(milk.client, "add_food_entry", { foodId: "803", amount: 300, unit: "ml", meal: "breakfast" });
  assert.equal(milk.writes()[0].params.serving_id, "1136448");
  assert.equal(milk.writes()[0].params.number_of_units, "300");

  const none = setup(diary());
  await assert.rejects(handleDataTool(none.client, "add_food_entry", { foodId: "777", amount: 5, unit: "ml", meal: "other" }), (e: unknown) => {
    assert.ok(e instanceof McpError);
    assert.equal(e.code, ErrorCode.InvalidParams);
    assert.ok(e.message.includes("3813024 (1 bar)"));
    assert.ok(e.message.includes("servingId + numberOfUnits"));
    return true;
  });
  assert.equal(none.writes().length, 0);
});

test("add_food_entry rejects serving 0, both amount ways, and neither", async () => {
  const { client, calls } = setup(diary());
  const base = { foodId: "3286", meal: "lunch" };
  await rejectsInvalid(handleDataTool(client, "add_food_entry", { ...base, servingId: "0", numberOfUnits: 100 }));
  await rejectsInvalid(handleDataTool(client, "add_food_entry", { ...base, servingId: "51966", numberOfUnits: 1, amount: 1, unit: "g" }));
  await rejectsInvalid(handleDataTool(client, "add_food_entry", base));
  await rejectsInvalid(handleDataTool(client, "add_food_entry", { ...base, amount: 5 }));
  await rejectsInvalid(handleDataTool(client, "add_food_entry", { ...base, servingId: "51966", numberOfUnits: 1.5, meal: "snack" }));
  await rejectsInvalid(handleDataTool(client, "add_food_entry", { ...base, servingId: "999", numberOfUnits: 1 }));
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("add_food_entry when food.get.v5 fails: writes with a name, errors without", async () => {
  const responder = diary((p) => { if (p.method === "food.get.v5") throw fail(106, "Invalid ID"); });
  const named = setup(responder);
  await handleDataTool(named.client, "add_food_entry", {
    foodId: "1", servingId: "5", numberOfUnits: 0.6, meal: "lunch", foodEntryName: "Mobile food",
  });
  assert.equal(named.writes().length, 1);
  assert.equal(named.writes()[0].params.food_entry_name, "Mobile food");

  const unnamed = setup(responder);
  await assert.rejects(handleDataTool(unnamed.client, "add_food_entry", {
    foodId: "1", servingId: "5", numberOfUnits: 1, meal: "lunch",
  }), /106 - Invalid ID/);
  const byAmount = setup(responder);
  await assert.rejects(handleDataTool(byAmount.client, "add_food_entry", {
    foodId: "1", amount: 5, unit: "g", meal: "lunch", foodEntryName: "x",
  }), /106 - Invalid ID/);
  assert.equal(unnamed.writes().length + byAmount.writes().length, 0);
});

test("add_food_entry reports success when the read-back fails", async () => {
  const { client } = setup(diary((p) => { if (p.method === "food_entries.get.v2") throw new Error("boom"); }));
  const result = await handleDataTool(client, "add_food_entry", {
    foodId: "3286", servingId: "51966", numberOfUnits: 60, meal: "lunch",
  });
  assert.match(text(result), /^Food entry added successfully \(food_entry_id 99\), but reading it back failed: .*boom.*Do not add it again; check with get_user_food_entries\.$/);
});

test("add_food_entry and update_food_entry reject missing user auth before any request", async () => {
  for (const [name, args] of [
    ["add_food_entry", { foodId: "3286", servingId: "51966", numberOfUnits: 60, meal: "lunch" }],
    ["update_food_entry", { foodEntryId: "99", numberOfUnits: 60 }],
    ["delete_food_entry", { foodEntryId: "99" }],
  ] as const) {
    for (const missing of ["accessToken", "accessTokenSecret"] as const) {
      const { client, calls } = setup(diary());
      client.config[missing] = undefined;
      await assert.rejects(handleDataTool(client, name, args), { code: ErrorCode.InvalidRequest, message: /User authentication required/ });
      assert.deepEqual(calls, []);
    }
  }
});

test("delete_food_entry sends food_entry.delete with the id", async () => {
  const { client, calls } = setup();
  const result = await handleDataTool(client, "delete_food_entry", { foodEntryId: "123" });
  assert.deepEqual(calls, [{
    method: "POST", url: FATSECRET_API_URL,
    params: { method: "food_entry.delete", food_entry_id: "123", format: "json" }, userAuth: true,
  }]);
  assert.ok(text(result).startsWith("Food entry deleted successfully!"));
  const failing = setup(fail(106, "Invalid ID"));
  await assert.rejects(handleDataTool(failing.client, "delete_food_entry", { foodEntryId: "1" }), /Failed to delete food entry: FatSecret API error: 106 - Invalid ID/);
});

test("update_food_entry keeps the entry id, re-reads it and guards g/ml amounts", async () => {
  const { client, calls, writes } = setup(diary());
  const result = await handleDataTool(client, "update_food_entry", {
    foodEntryId: "99", numberOfUnits: 80, meal: "dinner", foodEntryName: "Porridge",
  });
  assert.deepEqual(calls.map((c) => c.params.method), [
    "food_entries.get.v2", "food.get.v5", "food_entry.edit", "food_entries.get.v2",
  ]);
  assert.equal(calls[1].params.food_id, "3286");
  assert.deepEqual(writes()[0].params, {
    method: "food_entry.edit", food_entry_id: "99", food_entry_name: "Porridge",
    number_of_units: "80", meal: "dinner", format: "json",
  });
  assert.ok(text(result).startsWith("Food entry updated successfully!\n\n"));
  assert.equal(JSON.parse(text(result).split("\n\n")[1]).food_entry_description, "60 g Oats");

  await rejectsInvalid(handleDataTool(client, "update_food_entry", { foodEntryId: "99", numberOfUnits: 0.6 }));
  assert.equal(writes().length, 1);
  await handleDataTool(client, "update_food_entry", { foodEntryId: "99", numberOfUnits: 0.6, force: true });
  assert.equal(writes().length, 2);
});

test("update_food_entry skips the guard when the food is unknown, sends meal alone without reads, and needs a field", async () => {
  const unknown = setup(diary((p) => { if (p.method === "food.get.v5") throw fail(106, "Invalid ID"); }));
  await handleDataTool(unknown.client, "update_food_entry", { foodEntryId: "99", numberOfUnits: 0.6 });
  assert.equal(unknown.writes().length, 1);

  const mealOnly = setup(diary());
  await handleDataTool(mealOnly.client, "update_food_entry", { foodEntryId: "99", meal: "other" });
  assert.deepEqual(mealOnly.calls.map((c) => c.params.method), ["food_entry.edit", "food_entries.get.v2"]);

  const unreadable = setup(diary((p) => { if (p.method === "food_entries.get.v2") throw fail(106, "Invalid ID"); }));
  await assert.rejects(handleDataTool(unreadable.client, "update_food_entry", { foodEntryId: "99", numberOfUnits: 1 }), /Failed to get food entry/);
  assert.equal(unreadable.writes().length, 0);

  const empty = setup(diary());
  for (const args of [{ foodEntryId: "99" }, { foodEntryId: "99", numberOfUnits: undefined, meal: undefined }, { foodEntryId: "99", foodId: "4", date: "2026-01-01" }]) {
    await assert.rejects(handleDataTool(empty.client, "update_food_entry", args), { code: ErrorCode.InvalidParams, message: /At least one update field is required/ });
  }
  assert.deepEqual(empty.calls, []);
});

const entriesResponse = (entries: unknown) => ({ food_entries: entries === null ? null : { food_entry: entries } });
const dayEntries = [
  { calories: "130", protein: "10.43", fat: "3.00", carbohydrate: "15.44", meal: "Breakfast", date_int: "20738" },
  { calories: "212", protein: "11.85", fat: "1.69", carbohydrate: "37.37", meal: "Breakfast", date_int: "20738" },
  { calories: "300.5", protein: "20", fat: "10", carbohydrate: "30", meal: "Lunch", date_int: "20738" },
];

test("get_user_food_entries adds totals overall and per meal", async () => {
  const { client, calls } = setup(() => entriesResponse(dayEntries));
  const result = JSON.parse(text(await handleDataTool(client, "get_user_food_entries", { date: "2026-10-12" })));
  assert.equal(calls[0].params.date, "20738");
  assert.deepEqual(result.totals, {
    calories: 642.5, protein: 42.28, fat: 14.69, carbohydrate: 82.81,
    by_meal: {
      breakfast: { calories: 342, protein: 22.28, fat: 4.69, carbohydrate: 52.81 },
      lunch: { calories: 300.5, protein: 20, fat: 10, carbohydrate: 30 },
    },
  });
  assert.equal(result.food_entries.food_entry.length, 3);
  assert.equal(result.food_entries.food_entry[0].date, "2026-10-12");
});

test("get_user_food_entries handles an empty day and a single entry object", async () => {
  const empty = setup(() => entriesResponse(null));
  const none = JSON.parse(text(await handleDataTool(empty.client, "get_user_food_entries", { date: "2026-10-12" })));
  assert.deepEqual(none.food_entries.food_entry, []);
  assert.deepEqual(none.totals, { calories: 0, protein: 0, fat: 0, carbohydrate: 0, by_meal: {} });

  const single = setup(() => entriesResponse(dayEntries[0]));
  const one = JSON.parse(text(await handleDataTool(single.client, "get_user_food_entries", { foodEntryId: "1" })));
  assert.equal(Array.isArray(one.food_entries.food_entry), true);
  assert.equal(one.food_entries.food_entry.length, 1);
  assert.equal(one.totals.by_meal.breakfast.calories, 130);
});

test("get_food returns servings as an array with kcal_per_unit and flags serving 0", async () => {
  const single = setup(() => ({ food: { food_id: "1", servings: { serving: OATS_SERVING } } }));
  const one = JSON.parse(text(await handleDataTool(single.client, "get_food", { foodId: "1" })));
  assert.equal(single.calls[0].params.method, "food.get.v5");
  assert.equal(one.food.servings.serving.length, 1);
  assert.equal(one.food.servings.serving[0].kcal_per_unit, 3.54);
  assert.equal("loggable" in one.food.servings.serving[0], false);

  const several = setup(() => ({ food: { servings: { serving: [REFERENCE_SERVING, { serving_id: "5", number_of_units: "0", calories: "10" }] } } }));
  const many = JSON.parse(text(await handleDataTool(several.client, "get_food", { foodId: "1" })));
  assert.equal(many.food.servings.serving[0].loggable, false);
  assert.equal("kcal_per_unit" in many.food.servings.serving[1], false);
});

test("search_foods always returns foods.food as an array", async () => {
  const one = setup(() => ({ foods: { food: { food_id: "1" }, total_results: "1" } }));
  const single = JSON.parse(text(await handleDataTool(one.client, "search_foods", { searchExpression: "egg" })));
  assert.equal(one.calls[0].params.method, "foods.search");
  assert.deepEqual(single.foods.food, [{ food_id: "1" }]);
  const zero = setup(() => ({ foods: { total_results: "0" } }));
  const none = JSON.parse(text(await handleDataTool(zero.client, "search_foods", { searchExpression: "zzz" })));
  assert.deepEqual(none.foods.food, []);
});

test("*date_int keys gain ISO date siblings, recursively", async () => {
  const { client } = setup(() => ({
    month: { from_date_int: "20738", to_date_int: 20739, days: [{ date_int: "0", last_weight_date_int: "20738" }], other_date_int: "n/a" },
  }));
  const result = JSON.parse(text(await handleDataTool(client, "get_exercise_month", {})));
  assert.equal(result.month.from_date, "2026-10-12");
  assert.equal(result.month.to_date, "2026-10-13");
  assert.equal(result.month.days[0].date, "1970-01-01");
  assert.equal(result.month.days[0].last_weight_date, "2026-10-12");
  assert.equal("other_date" in result.month, false);
  assert.equal(result.month.from_date_int, "20738");
});

test("a premier tool failing with error 10 names the plan; other tools and errors do not", async () => {
  const unknown = setup(fail(10, "Unknown method"));
  await assert.rejects(handleDataTool(unknown.client, "autocomplete_foods", { expression: "egg" }), (e: unknown) => {
    assert.ok(e instanceof McpError);
    assert.ok(e.message.endsWith(" This method is not included in the API key's FatSecret plan (Premier required)."));
    return true;
  });
  await assert.rejects(handleDataTool(unknown.client, "get_saved_meals", {}), (e: unknown) => {
    assert.ok(e instanceof McpError);
    assert.ok(e.message.endsWith("FatSecret API error: 10 - Unknown method"));
    return true;
  });
  const other = setup(fail(106, "Invalid ID"));
  await assert.rejects(handleDataTool(other.client, "autocomplete_foods", { expression: "egg" }), (e: unknown) => {
    assert.ok(e instanceof McpError);
    assert.ok(e.message.endsWith("106 - Invalid ID"));
    return true;
  });
  const premier = dataTools.filter((t) => t.description.startsWith("[FatSecret Premier plan only; a Basic key answers error 10] ")).map((t) => t.name).sort();
  assert.deepEqual(premier, ["autocomplete_foods", "create_food", "find_food_by_barcode", "get_food_brands", "get_food_categories", "get_food_sub_categories", "process_natural_language", "recognize_food_image", "search_foods_v5", "submit_food_feedback"]);
});

test("get_favorite_recipes sends recipes.get_favorites.v2", async () => {
  const { client, calls } = setup();
  await handleDataTool(client, "get_favorite_recipes", {});
  assert.equal(calls[0].params.method, "recipes.get_favorites.v2");
});

for (const [name, args, method, userAuth, expected] of [
  ["get_recipe", { recipeId: "1" }, "recipe.get.v2", false, { recipe_id: "1" }],
  ["search_recipes", { searchExpression: "egg" }, "recipes.search.v3", false, { search_expression: "egg" }],
  ["get_user_profile", {}, "profile.get", true, {}],
  ["get_weight_month", { date: "1970-01-01" }, "weights.get_month.v2", true, { date: "0" }],
  ["get_food", { foodId: "1" }, "food.get.v5", false, { food_id: "1" }],
] as const) {
  test(`${name} uses ${method} with ${userAuth ? "user" : "consumer"} auth`, async () => {
    const { client, calls } = setup();
    await handleDataTool(client, name, args);
    assert.deepEqual(calls, [{ method: "GET", url: FATSECRET_API_URL, params: { method, ...expected, format: "json" }, userAuth }]);
  });
}

test("check_auth_status reports the credential state", async () => {
  const { client } = setup();
  assert.match(text(await handleDataTool(client, "check_auth_status")), /Fully authenticated/);
  client.config.accessToken = undefined;
  assert.match(text(await handleDataTool(client, "check_auth_status")), /Credentials set, authentication needed/);
});
