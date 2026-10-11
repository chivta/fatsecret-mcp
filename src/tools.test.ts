import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { FATSECRET_API_URL, FatSecretClient } from "./fatsecret.js";
import { dataTools, handleDataTool } from "./tools.js";

function setup(error?: Error) {
  const client = new FatSecretClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
    accessTokenSecret: "access-token-secret",
  });
  const calls: {
    method: string;
    url: string;
    params: Record<string, string>;
    userAuth: boolean;
  }[] = [];
  const response = { success: { value: "1" } };
  client.makeApiRequest = async (method, url, params = {}, userAuth = true) => {
    calls.push({ method, url, params, userAuth });
    if (error) throw error;
    return response;
  };
  return { client, calls, response };
}

test("dataTools registers delete_food_entry and update_food_entry schemas", () => {
  const deletion = dataTools.filter((tool) => tool.name === "delete_food_entry");
  const updates = dataTools.filter((tool) => tool.name === "update_food_entry");
  assert.equal(deletion.length, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(deletion[0].inputSchema.required, ["foodEntryId"]);
  assert.deepEqual(deletion[0].inputSchema.properties, {
    foodEntryId: {
      type: "string",
      description: "The food entry ID retrieved by get_user_food_entries",
    },
  });
  const schema = updates[0].inputSchema;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["foodEntryId"]);
  assert.deepEqual(schema.properties, {
    ...deletion[0].inputSchema.properties,
    foodEntryName: { type: "string", description: "Name shown in the diary" },
    servingId: { type: "string", description: "The serving ID for the food" },
    quantity: { type: "number", description: "Quantity of the serving" },
    mealType: {
      type: "string",
      description: "Meal type (breakfast, lunch, dinner, other)",
      enum: ["breakfast", "lunch", "dinner", "other"],
    },
  });
  assert.deepEqual(schema.anyOf, [
    { required: ["foodEntryName"] },
    { required: ["servingId"] },
    { required: ["quantity"] },
    { required: ["mealType"] },
  ]);
  assert.equal("foodId" in schema.properties, false);
  assert.equal("date" in schema.properties, false);
});

test("delete_food_entry maps its ID to an authenticated POST and formats success", async () => {
  const { client, calls, response } = setup();
  const result = await handleDataTool(client, "delete_food_entry", { foodEntryId: "123" });
  assert.deepEqual(calls, [{
    method: "POST",
    url: FATSECRET_API_URL,
    params: { method: "food_entry.delete", food_entry_id: "123", format: "json" },
    userAuth: true,
  }]);
  assert.deepEqual(result, {
    content: [{ type: "text", text: `Food entry deleted successfully!\n\n${JSON.stringify(response, null, 2)}` }],
  });
});

test("update_food_entry maps all editable fields and formats success", async () => {
  const { client, calls, response } = setup();
  const result = await handleDataTool(client, "update_food_entry", {
    foodEntryId: "123",
    foodEntryName: "Lunch apple",
    servingId: "456",
    quantity: 1.5,
    mealType: "other",
    foodId: "cannot-change",
    date: "2026-01-01",
  });
  assert.deepEqual(calls, [{
    method: "POST",
    url: FATSECRET_API_URL,
    params: {
      method: "food_entry.edit",
      food_entry_id: "123",
      food_entry_name: "Lunch apple",
      serving_id: "456",
      number_of_units: "1.5",
      meal: "other",
      format: "json",
    },
    userAuth: true,
  }]);
  assert.deepEqual(result, {
    content: [{ type: "text", text: `Food entry updated successfully!\n\n${JSON.stringify(response, null, 2)}` }],
  });
});

for (const [field, value, apiField, apiValue] of [
  ["foodEntryName", "Apple", "food_entry_name", "Apple"],
  ["servingId", "456", "serving_id", "456"],
  ["quantity", 0, "number_of_units", "0"],
  ["mealType", "breakfast", "meal", "breakfast"],
] as const) {
  test(`update_food_entry sends only ${field} for a partial update`, async () => {
    const { client, calls } = setup();
    await handleDataTool(client, "update_food_entry", {
      foodEntryId: "123",
      foodEntryName: undefined,
      servingId: undefined,
      quantity: undefined,
      mealType: undefined,
      [field]: value,
    });
    assert.deepEqual(calls, [{
      method: "POST",
      url: FATSECRET_API_URL,
      params: {
        method: "food_entry.edit",
        food_entry_id: "123",
        [apiField]: apiValue,
        format: "json",
      },
      userAuth: true,
    }]);
  });
}

for (const [name, args, action] of [
  ["delete_food_entry", { foodEntryId: "123" }, "delete food entry"],
  ["update_food_entry", { foodEntryId: "123", quantity: 1 }, "update food entry"],
] as const) {
  for (const missing of ["accessToken", "accessTokenSecret"] as const) {
    test(`${name} rejects missing ${missing} before making a request`, async () => {
      const { client, calls } = setup();
      client.config[missing] = undefined;
      await assert.rejects(handleDataTool(client, name, args), (error: unknown) => {
        assert.ok(error instanceof McpError);
        assert.equal(error.code, ErrorCode.InvalidRequest);
        assert.match(error.message, /User authentication required/);
        return true;
      });
      assert.deepEqual(calls, []);
    });
  }

  test(`${name} wraps API failure with its action`, async () => {
    const { client, calls } = setup(new Error("FatSecret API error: 106 - Invalid ID"));
    await assert.rejects(handleDataTool(client, name, args), (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, ErrorCode.InternalError);
      assert.ok(error.message.includes(`Failed to ${action}: FatSecret API error: 106 - Invalid ID`));
      return true;
    });
    assert.equal(calls.length, 1);
  });
}

test("update_food_entry rejects empty updates without making a request", async () => {
  const { client, calls } = setup();
  for (const args of [
    { foodEntryId: "123" },
    { foodEntryId: "123", foodEntryName: undefined, servingId: undefined, quantity: undefined, mealType: undefined },
    { foodEntryId: "123", foodId: "456", date: "2026-01-01" },
  ]) {
    await assert.rejects(handleDataTool(client, "update_food_entry", args), (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, ErrorCode.InvalidParams);
      assert.match(error.message, /At least one update field is required/);
      return true;
    });
  }
  assert.deepEqual(calls, []);
});
