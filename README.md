# FatSecret MCP Server

A Model Context Protocol (MCP) server that provides access to the FatSecret nutrition database API with full 3-Legged OAuth authentication support.

## Features

- **Complete OAuth 1.0a Implementation**: Full 3-legged OAuth flow for user authentication
- **Food Database Access**: Search and retrieve detailed nutrition information
- **Recipe Database**: Search for recipes and get detailed cooking instructions
- **User Data Management**: Access user food diaries and add, update, or delete food entries
- **Secure Credential Storage**: Encrypted storage of API credentials and tokens

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A FatSecret developer account

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/fatsecret-mcp.git
cd fatsecret-mcp

# Install dependencies
npm install

# Build the TypeScript
npm run build
```

## Setup

### 1. Get FatSecret API Credentials

1. Visit the [FatSecret Platform](https://platform.fatsecret.com/)
2. Create a developer account and register your application
3. Note down your **Client ID** and **Client Secret**

### 2. Configure the MCP Server

The server needs to be configured in your MCP client (like Claude Desktop). Add this to your MCP configuration:

```json
{
  "mcpServers": {
    "fatsecret": {
      "command": "node",
      "args": ["path/to/fatsecret-mcp-server/dist/index.js"]
    }
  }
}
```

### 3. Authentication Process

#### Option 1: Using the OAuth Console Utility (Recommended)

The easiest way to authenticate is using the included OAuth console utility:

```bash
# Make sure you've built the project first
npm run build

# Run the OAuth console utility
node dist/cli.js
```

This interactive utility will:
1. Ask for your Client ID and Client Secret
2. Save them securely in `~/.fatsecret-mcp-config.json`
3. Guide you through the OAuth flow:
   - Opens your browser to the FatSecret authorization page
   - Prompts you to paste the verifier code after authorization
   - Saves the access tokens for future use

#### Option 2: Manual Authentication via MCP Tools

If you prefer to authenticate through the MCP interface (e.g., in Claude):

1. **Set your API credentials:**
   ```
   Use tool: set_credentials
   Parameters:
   - clientId: "your_client_id_here"
   - clientSecret: "your_client_secret_here"
   ```

2. **Start the OAuth flow:**
   ```
   Use tool: start_oauth_flow
   Parameters:
   - callbackUrl: "oob" (for out-of-band authentication)
   ```

3. **Visit the authorization URL** provided in the response:
   - Log in to your FatSecret account (or create one)
   - Click "Allow" to authorize the application
   - Copy the verifier code shown on the page

4. **Complete the OAuth flow:**
   ```
   Use tool: complete_oauth_flow
   Parameters:
   - requestToken: [from step 2 response]
   - requestTokenSecret: [from step 2 response]
   - verifier: [the code you copied from the authorization page]
   ```

#### Option 3: Using Environment Variables

You can also provide credentials via environment variables:

```bash
# Create a .env file in the project root
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here

# The server will automatically load these on startup
```

Note: You'll still need to complete the OAuth flow for user-specific operations.

## Usage

### 1. Set API Credentials

First, set your FatSecret API credentials:

```
Use the set_credentials tool with your Client ID and Client Secret
```

### 2. Authenticate a User (3-Legged OAuth)

For user-specific operations, you need to complete the OAuth flow:

```
1. Use start_oauth_flow tool (with callback URL or "oob" for out-of-band)
2. Visit the provided authorization URL
3. Authorize the application and get the verifier code
4. Use complete_oauth_flow tool with the request token, secret, and verifier
```

### 3. Use the API

Once authenticated, you can use all available tools:

#### Food Search and Information

- `search_foods`: Search for foods in the database
- `get_food`: Get detailed nutrition information for a specific food

#### Recipe Search and Information

- `search_recipes`: Search for recipes
- `get_recipe`: Get detailed recipe information including ingredients and instructions

#### User Data (Requires Authentication)

- `get_user_profile`: Get the authenticated user's profile
- `get_user_food_entries`: Get food diary entries for a specific date
- `add_food_entry`: Add a food entry to the user's diary
- `delete_food_entry`: Delete a food entry from the user's diary
- `update_food_entry`: Update a food entry in the user's diary

#### Utility

- `check_auth_status`: Check current authentication status

## Available Tools

### Authentication Tools

#### `set_credentials`

Set your FatSecret API credentials.

**Parameters:**

- `clientId` (string, required): Your FatSecret Client ID
- `clientSecret` (string, required): Your FatSecret Client Secret

#### `start_oauth_flow`

Start the 3-legged OAuth flow.

**Parameters:**

- `callbackUrl` (string, optional): OAuth callback URL (default: "oob")

#### `complete_oauth_flow`

Complete the OAuth flow with authorization.

**Parameters:**

- `requestToken` (string, required): Request token from start_oauth_flow
- `requestTokenSecret` (string, required): Request token secret from start_oauth_flow
- `verifier` (string, required): OAuth verifier from authorization

#### `check_auth_status`

Check current authentication status.

### Food Database Tools

#### `search_foods`

Search for foods in the FatSecret database.

**Parameters:**

- `searchExpression` (string, required): Search term
- `pageNumber` (number, optional): Page number (default: 0)
- `maxResults` (number, optional): Max results per page (default: 20)

#### `get_food`

Get detailed information about a specific food.

**Parameters:**

- `foodId` (string, required): FatSecret food ID

### Recipe Database Tools

#### `search_recipes`

Search for recipes in the FatSecret database.

**Parameters:**

- `searchExpression` (string, required): Search term
- `pageNumber` (number, optional): Page number (default: 0)
- `maxResults` (number, optional): Max results per page (default: 20)

#### `get_recipe`

Get detailed information about a specific recipe.

**Parameters:**

- `recipeId` (string, required): FatSecret recipe ID

### User Data Tools (Requires Authentication)

#### `get_user_profile`

Get the authenticated user's profile information.

#### `get_user_food_entries`

Get user's food diary entries for a specific date.

**Parameters:**

- `date` (string, optional): Date in YYYY-MM-DD format (default: today)

#### `add_food_entry`

Add a food entry to the user's diary.

**Parameters:**

- `foodId` (string, required): FatSecret food ID
- `servingId` (string, required): Serving ID for the food
- `quantity` (number, required): Quantity of the serving
- `mealType` (string, required): Meal type (breakfast, lunch, dinner, other)
- `date` (string, optional): Date in YYYY-MM-DD format (default: today)

#### `delete_food_entry`

Delete a food entry from the user's diary.

**Parameters:**

- `foodEntryId` (string, required): Food entry ID retrieved by `get_user_food_entries`

#### `update_food_entry`

Update a food entry in the user's diary. At least one optional update field must be provided. Omitted fields remain unchanged; the entry's food ID and date cannot be updated.

**Parameters:**

- `foodEntryId` (string, required): Food entry ID retrieved by `get_user_food_entries`
- `foodEntryName` (string, optional): Name shown in the diary
- `servingId` (string, optional): Serving ID for the food
- `quantity` (number, optional): Quantity of the serving
- `mealType` (string, optional): Meal type (breakfast, lunch, dinner, other)

## Full Platform operation coverage

Both stdio and HTTP expose the same **55 data tools**: **48 current Platform operations**,
**6 retained legacy-version alternatives**, and `check_auth_status`. The declarative catalog
contains 44 new tools; 10 original API tools remain unchanged. Coverage is based on the current
[official guides navigation](https://platform.fatsecret.com/docs/guides) and its linked operation
pages (all fetched during implementation). The redundant `v1/foods.search` link is covered by
the retained `search_foods` tool. The table below identifies the tool for each **latest** version.
Existing tools keep their names, inputs, defaults, response formatting, and methods; six additive
versioned tools expose the newer search filters and response formats without breaking compatibility.
Tools use the latest documented method-based API where available, and documented path endpoints otherwise.

### Access and input conventions

- **App** means consumer-only OAuth1 signing with the configured Client ID/Secret. **User**
  additionally requires the configured OAuth1 access token/secret. There is no new configuration
  or OAuth2 dependency. Feature availability still depends on your FatSecret account's permissions.
- Barcode lookup, autocomplete, brands/categories/subcategories, feedback, NLP/image recognition,
  food creation, and `search_foods_v5` require Premier or the corresponding feature entitlement. Localization
  parameters/features also require Premier access where marked in the official pages. Autocomplete
  v2 only supports the default region/language combination; `maxResults` cannot exceed 10.
- New tools validate camelCase arguments, types, enums, real calendar dates, and documented
  conditional requirements before calling the API. IDs for form APIs are strings (to avoid
  precision loss); JSON `eatenFoods.foodId` and `returnedFood` IDs are integers. Barcode inputs
  are **13-digit GTIN-13 strings**, preserving leading zeroes, including feedback (whose example
  uses a string despite its table saying Int). Convert UPC-E to UPC-A before padding to GTIN-13.
- Dates are `YYYY-MM-DD` and converted at UTC to days since 1970-01-01. Absent optional
  parameters are omitted; FatSecret supplies documented defaults, including current-day dates.
  Required dates remain required even where the table also mentions a default. `false`, `0`,
  and empty arrays are preserved. `meals` and `recipeTypes` arrays become comma-separated strings.
  MCP results use JSON; the API output `format` parameter is managed by the client, not exposed as an input.
- `create_profile` and `get_profile_auth` are **managed-profile** APIs, distinct from the
  existing `get_user_profile` and three-legged OAuth flow. They return **sensitive tokens/secrets**
  and never update the server's configured tokens. Keep returned credentials private.
  `get_profile_auth` uses consumer-only signing and optional `userId` to nominate a managed
  profile; FatSecret enforces ownership/access. Omitted `userId` behavior has not been live-verified.
- NLP, image recognition, and feedback use OAuth1-signed JSON POSTs to their documented path
  endpoints, not invented `server.api` methods. JSON fields are excluded from the OAuth1
  signature as specified by [OAuth Core 1.0 §9.1.1](https://oauth.net/core/1.0/#rfc.section.9.1.1);
  signed OAuth parameters are sent in the query. The official operation pages advertise OAuth1
  support. No live authenticated or account requests were used to verify entitlements.
- NLP/image `eatenFoods` is an array of objects: `foodId` (integer, required), `foodName`
  (string, required), `foodBrand`, `servingDescription`, `servingSize` (optional strings).
  Omit optional fields rather than passing null; `servingSize` follows the documented string type.
  NLP `userInput` is limited to 1,000 Unicode code points (matching JSON Schema `maxLength`),
  and its complete JSON body to 1 MiB (UTF-8).
  Image `imageB64` is limited to 999,982 characters; its whole JSON body to 1,048,576 characters.
  Image formats: jpg/png/webp, recommended 256×256 or 512×512. Review suggested matches and
  servings before logging them; recognition may not return nutrition for every match.
  The HTTP `/mcp` JSON parser permits at most **4 MiB** to accommodate UTF-8 tool payloads
  and their JSON-RPC envelope; larger requests return **HTTP 413**, not a server error.
  Operation-specific upstream limits still apply. OAuth form parsers are unchanged.
- Feedback submits metadata only; signed image-upload URLs are returned to the caller. This
  server does not upload images. `returnedFood` is an object with optional integer `foodId` and
  `servingId`; `servingId: 0` is valid. `issueTypeId` values: 1 wrong name/brand, 2 nutrition,
  3 missing serving, 4 missing barcode, 99 other. Type 1 requires `barcode` and
  `returnedFood.foodId`; types 2/3 require both returned IDs; type 99 requires `issueType`.
- `update_exercise_entry` moves minutes from one exercise to another so the day stays at
  24 hours. `shiftToId: "0"` requires `shiftToName` and `kcal`; `shiftFromId: "0"` requires
  `shiftFromName`. Both shift IDs must be canonical decimal strings (`0` or a nonzero
  digit followed by digits); leading-zero forms such as `00` and `01` are rejected. Template `days` is the documented weekday bit mask (0–128).
- `update_saved_meal_item` requires at least one of `savedMealItemName`/`numberOfUnits`;
  its serving cannot change. A first `update_weight` requires `goalWeightKg` and
  `currentHeightCm` in addition to `currentWeightKg` (FatSecret checks existing profile state).
  Weight tracking information is not a substitute for professional medical evaluation.
- `get_user_food_entries_v2` accepts `date` or `foodEntryId` (at least one is required).
  Its schema/runtime deliberately follow the official **alternate-lookup description**, rather
  than requiring both fields as the contradictory table suggests. Omitted fields are not sent;
  no local today default is invented for an empty lookup.
- `search_recipes_v3` accepts `recipeTypes` string arrays from `get_recipe_types`;
  `recipeTypesMatchall` controls all-vs-any matching. Integer nutrition/time range inputs such as
  `caloriesFrom` and `prepTimeTo` map to the documented dotted wire keys (`calories.from`,
  `prep_time.to`). Search limits are at most 50; optional `searchExpression` may be omitted.
- New tools provide read-only/destructive MCP annotations. Annotations are advisory;
  account write operations still execute when invoked by an authorized caller.

### Operation-to-tool table

| Official navigation operation | MCP tool | Wire operation / endpoint | Access |
| --- | --- | --- | --- |
| [v1/exercise_entries.commit_day](https://platform.fatsecret.com/docs/v1/exercise_entries.commit_day) | `commit_exercise_day` | `exercise_entries.commit_day` | User |
| [v1/exercise_entries.save_template](https://platform.fatsecret.com/docs/v1/exercise_entries.save_template) | `save_exercise_template` | `exercise_entries.save_template` | User |
| [v1/exercise_entry.edit](https://platform.fatsecret.com/docs/v1/exercise_entry.edit) | `update_exercise_entry` | `exercise_entry.edit` | User |
| [v1/feedback](https://platform.fatsecret.com/docs/v1/feedback) | `submit_food_feedback` | `POST /rest/feedback/v1` | App |
| [v1/food.add_favorite](https://platform.fatsecret.com/docs/v1/food.add_favorite) | `add_favorite_food` | `food.add_favorite` | User |
| [v1/food.delete_favorite](https://platform.fatsecret.com/docs/v1/food.delete_favorite) | `delete_favorite_food` | `food.delete_favorite` | User |
| [v1/food_entries.copy](https://platform.fatsecret.com/docs/v1/food_entries.copy) | `copy_food_entries` | `food_entries.copy` | User |
| [v1/food_entries.copy_saved_meal](https://platform.fatsecret.com/docs/v1/food_entries.copy_saved_meal) | `copy_saved_meal_to_diary` | `food_entries.copy_saved_meal` | User |
| [v1/food_entry.create](https://platform.fatsecret.com/docs/v1/food_entry.create) | `add_food_entry` (existing) | `food_entry.create` | User |
| [v1/food_entry.delete](https://platform.fatsecret.com/docs/v1/food_entry.delete) | `delete_food_entry` (existing) | `food_entry.delete` | User |
| [v1/food_entry.edit](https://platform.fatsecret.com/docs/v1/food_entry.edit) | `update_food_entry` (existing) | `food_entry.edit` | User |
| [v1/natural.language.processing](https://platform.fatsecret.com/docs/v1/natural.language.processing) | `process_natural_language` | `POST /rest/natural-language-processing/v1` | App |
| [v1/profile.create](https://platform.fatsecret.com/docs/v1/profile.create) | `create_profile` | `profile.create` | App |
| [v1/profile.get](https://platform.fatsecret.com/docs/v1/profile.get) | `get_user_profile` (existing) | `profile.get` | User |
| [v1/profile.get_auth](https://platform.fatsecret.com/docs/v1/profile.get_auth) | `get_profile_auth` | `GET /rest/profile/auth/v1` | App |
| [v1/recipe.add_favorite](https://platform.fatsecret.com/docs/v1/recipe.add_favorite) | `add_favorite_recipe` | `recipe.add_favorite` | User |
| [v1/recipe.delete_favorite](https://platform.fatsecret.com/docs/v1/recipe.delete_favorite) | `delete_favorite_recipe` | `recipe.delete_favorite` | User |
| [v1/saved_meal.create](https://platform.fatsecret.com/docs/v1/saved_meal.create) | `create_saved_meal` | `saved_meal.create` | User |
| [v1/saved_meal.delete](https://platform.fatsecret.com/docs/v1/saved_meal.delete) | `delete_saved_meal` | `saved_meal.delete` | User |
| [v1/saved_meal.edit](https://platform.fatsecret.com/docs/v1/saved_meal.edit) | `update_saved_meal` | `saved_meal.edit` | User |
| [v1/saved_meal_item.add](https://platform.fatsecret.com/docs/v1/saved_meal_item.add) | `add_saved_meal_item` | `saved_meal_item.add` | User |
| [v1/saved_meal_item.delete](https://platform.fatsecret.com/docs/v1/saved_meal_item.delete) | `delete_saved_meal_item` | `saved_meal_item.delete` | User |
| [v1/saved_meal_item.edit](https://platform.fatsecret.com/docs/v1/saved_meal_item.edit) | `update_saved_meal_item` | `saved_meal_item.edit` | User |
| [v1/weight.update](https://platform.fatsecret.com/docs/v1/weight.update) | `update_weight` | `weight.update` | User |
| [v2/exercise_entries.get](https://platform.fatsecret.com/docs/v2/exercise_entries.get) | `get_user_exercise_entries` | `exercise_entries.get.v2` | User |
| [v2/exercise_entries.get_month](https://platform.fatsecret.com/docs/v2/exercise_entries.get_month) | `get_exercise_month` | `exercise_entries.get_month.v2` | User |
| [v2/exercises.get](https://platform.fatsecret.com/docs/v2/exercises.get) | `get_exercises` | `exercises.get.v2` | App |
| [v2/food.create](https://platform.fatsecret.com/docs/v2/food.create) | `create_food` | `food.create.v2` | User |
| [v2/food.find_id_for_barcode](https://platform.fatsecret.com/docs/v2/food.find_id_for_barcode) | `find_food_by_barcode` | `food.find_id_for_barcode.v2` | App |
| [v2/food_brands.get](https://platform.fatsecret.com/docs/v2/food_brands.get) | `get_food_brands` | `food_brands.get.v2` | App |
| [v2/food_categories.get](https://platform.fatsecret.com/docs/v2/food_categories.get) | `get_food_categories` | `food_categories.get.v2` | App |
| [v2/food_entries.get](https://platform.fatsecret.com/docs/v2/food_entries.get) | `get_user_food_entries_v2` | `food_entries.get.v2` | User |
| [v2/food_entries.get_month](https://platform.fatsecret.com/docs/v2/food_entries.get_month) | `get_food_entries_month` | `food_entries.get_month.v2` | User |
| [v2/food_sub_categories.get](https://platform.fatsecret.com/docs/v2/food_sub_categories.get) | `get_food_sub_categories` | `food_sub_categories.get.v2` | App |
| [v2/foods.autocomplete](https://platform.fatsecret.com/docs/v2/foods.autocomplete) | `autocomplete_foods` | `foods.autocomplete.v2` | App |
| [v2/foods.get_favorites](https://platform.fatsecret.com/docs/v2/foods.get_favorites) | `get_favorite_foods` | `foods.get_favorites.v2` | User |
| [v2/foods.get_most_eaten](https://platform.fatsecret.com/docs/v2/foods.get_most_eaten) | `get_most_eaten_foods` | `foods.get_most_eaten.v2` | User |
| [v2/foods.get_recently_eaten](https://platform.fatsecret.com/docs/v2/foods.get_recently_eaten) | `get_recently_eaten_foods` | `foods.get_recently_eaten.v2` | User |
| [v2/image.recognition](https://platform.fatsecret.com/docs/v2/image.recognition) | `recognize_food_image` | `POST /rest/image-recognition/v2` | App |
| [v2/recipe.get](https://platform.fatsecret.com/docs/v2/recipe.get) | `get_recipe_v2` | `recipe.get.v2` | App |
| [v2/recipe_types.get](https://platform.fatsecret.com/docs/v2/recipe_types.get) | `get_recipe_types` | `recipe_types.get.v2` | App |
| [v2/recipes.get_favorites](https://platform.fatsecret.com/docs/v2/recipes.get_favorites) | `get_favorite_recipes` | `recipe.get_favorites.v2` | User |
| [v2/saved_meal_items.get](https://platform.fatsecret.com/docs/v2/saved_meal_items.get) | `get_saved_meal_items` | `saved_meal_items.get.v2` | User |
| [v2/saved_meals.get](https://platform.fatsecret.com/docs/v2/saved_meals.get) | `get_saved_meals` | `saved_meals.get.v2` | User |
| [v2/weights.get_month](https://platform.fatsecret.com/docs/v2/weights.get_month) | `get_weight_month_v2` | `weights.get_month.v2` | User |
| [v3/recipes.search](https://platform.fatsecret.com/docs/v3/recipes.search) | `search_recipes_v3` | `recipes.search.v3` | App |
| [v5/food.get](https://platform.fatsecret.com/docs/v5/food.get) | `get_food_v5` | `food.get.v5` | App |
| [v5/foods.search](https://platform.fatsecret.com/docs/v5/foods.search) | `search_foods_v5` | `foods.search.v5` | App |

The `recipes.get_favorites` page documents the singular method
`recipe.get_favorites.v2`, which is used exactly as written. The `profile.get_auth`
page's method table conflicts with its purpose (`profile.get`), so the unambiguous
`GET /rest/profile/auth/v1` endpoint is used instead. No operation is silently omitted.

`get_weight_month` (existing) accepts optional string `date` in `YYYY-MM-DD` format,
defaulting to the current month, and calls `weights.get_month` with user authentication.

### Retained legacy-version alternatives

These six compatibility tools retain their original inputs and unversioned methods; prefer
the versioned alternatives for all current filters and latest response shapes.

| Legacy tool | Preserved method | Latest additive tool |
| --- | --- | --- |
| `get_food` | `food.get` | `get_food_v5` |
| `search_foods` | `foods.search` | `search_foods_v5` |
| `get_recipe` | `recipe.get` | `get_recipe_v2` |
| `search_recipes` | `recipes.search` | `search_recipes_v3` |
| `get_user_food_entries` | `food_entries.get` | `get_user_food_entries_v2` |
| `get_weight_month` | `weights.get_month` | `get_weight_month_v2` |

### New tools and parameters

Parameters below use the MCP camelCase spelling; wire names and detailed units are also
provided in each tool's discoverable input schema. All unmarked parameters are optional.

#### `commit_exercise_day`

Saves the default exercise entries for the user on a nominated date.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

#### `save_exercise_template`

Saves a day's exercise entries as the template for the nominated weekdays (days is a weekday bit mask).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `days` | integer | yes | The days of the week specified as bits with Sunday being the 1st bit and Saturday being the last and then converted to an Int. For example Tuesday and Thursday would be represented as 00010100 in bits or 20 in Int where Tuesday is the 3rd bit from the right and Thursday being the 5th. Must be between 0 and 128 Maximum: 128. |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

#### `update_exercise_entry`

Records a change to a user's exercise diary entry for a nominated date. All changes to an exercise diary involve either increasing the duration of an existing activity or introducing a new activity for a nominated duration. Because there are always 24 hours worth of exercise entries on any given date, the user must nominate the exercise or activity from which the time was taken to balance out the total duration of activities and exercises for the 24 hour period. As such, each change to the exercise entries on a given day is a "shifting" operation where time is moved from one activity to another. An exercise is removed from the day when all of the time allocated to it is shifted to other exercises.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `shiftToId` | string | yes | ID of the exercise type to shift to (canonical decimal string) |
| `shiftFromId` | string | yes | ID of the exercise type to shift from (canonical decimal string) |
| `minutes` | integer | yes | Duration in minutes |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |
| `shiftToName` | string | no | Only required if shift_to_id is 0 (exercise type "Other"). This is the name of the new custom exercise type to shift to |
| `shiftFromName` | string | no | Only required if shift_from_id is 0 (exercise type "Other"). This is the name of the custom exercise type to shift from |
| `kcal` | integer | no | Only required if shift_to_id is 0 (exercise type "Other"). This is the total number of kcals burned for this exercise |

Conditional required fields are enforced as described in the access/input conventions above.

#### `submit_food_feedback`

This API method enables developers to submit user feedback regarding potentially incorrect or missing food and/or barcode data. It supports a variety of issue types, including potential food or brand naming errors, incorrect nutrition facts, missing serving sizes, and unrecognized barcodes.  Requires Premier feature access; uses an OAuth1-signed JSON path endpoint.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `barcode` | string | no | A barcode where a food is associated incorrectly. Required when issue_type_id is 1 |
| `issueTypeId` | integer | yes | The type ID for the request. Valid options are 1 (Wrong Name/Brand), 2 (Wrong Nutrition Info), 3 (Missing Serving Size), 4 (Barcode not found), 99 (Other) Values: `1`, `2`, `3`, `4`, `99`. |
| `issueType` | string | no | Issue description. This is to be provided when the issue_type_id is 99 (Other) |
| `notes` | string | no | Custom notes regarding the issue |
| `externalId` | string | yes | Custom identifier for external use. E.g an external unique user identifier |
| `imageFileExtension` | string | no | The image file extension in which the signed uploads will be generated using. Accepts jpg, jpeg, png and tiff. Defaulted to jpg if not provided Values: `jpg`, `jpeg`, `png`, `tiff`. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |
| `returnedFood` | object | no | Food and serving related to feedback |

Conditional required fields are enforced as described in the access/input conventions above.

#### `add_favorite_food`

Add a food to a user's favorite according to the parameters specified.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `foodId` | string | yes | Unique food identifier |
| `servingId` | string | no | Unique serving identifier |
| `numberOfUnits` | number | no | Number of units in this standard serving size. For instance, if the serving description is "2 tablespoons" the number of units is "2", while if the serving size is "1 cup" the number of units is "1". Please note that this is only applicable for when food_type is "Generic" whereas for "Brand" the number of units will always be "1" |

#### `delete_favorite_food`

Deletes the specified food from the user's favorite.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `foodId` | string | yes | Unique food identifier |
| `servingId` | string | no | Unique serving identifier |
| `numberOfUnits` | number | no | Number of units in this standard serving size. For instance, if the serving description is "2 tablespoons" the number of units is "2", while if the serving size is "1 cup" the number of units is "1". Please note that this is only applicable for when food_type is "Generic" whereas for "Brand" the number of units will always be "1" |

#### `copy_food_entries`

Copies the food entries for a specified meal from a nominated date to a nominated date.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `fromDate` | string | yes | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Date to copy food entries from expressed in the number of days since January 1, 1970 |
| `toDate` | string | yes | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Date to copy food entries to expressed in the number of days since January 1, 1970 (default value is the current day) |
| `meal` | string | no | Type of meal eaten. Valid meal types are "breakfast", "lunch", "dinner" and "other" Values: `breakfast`, `lunch`, `dinner`, `other`. |

#### `copy_saved_meal_to_diary`

Copies the food entries for a specified saved meal to a specified meal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealId` | string | yes | Unique saved meal identifier |
| `meal` | string | yes | Type of meal eaten. Valid meal types are "breakfast", "lunch", "dinner" and "other" Values: `breakfast`, `lunch`, `dinner`, `other`. |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

#### `process_natural_language`

Parses a description of eaten foods into FatSecret food matches and servings. Requires Premier feature access; uses an OAuth1-signed JSON path endpoint.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userInput` | string | yes | A description of what a user has eaten. May contain multiple items. e.g. "A toast with ham and cheese, an apple, a banana and a cappuccino". This field is limited to 1000 characters |
| `includeFoodData` | boolean | no | Include full food data in the response (see our food.get API) |
| `eatenFoods` | object[] | no | Previously consumed foods to improve matching. Optional fields should be omitted, not null. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `create_profile`

Creates a new profile. Returns sensitive OAuth tokens/secrets; do not share the result. Does not change configured credentials.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | string | yes | You can set your own ID for the newly created profile if you do not wish to store the auth_token and auth_secret |

#### `get_profile_auth`

Returns the authentication information for a nominated user. Returns sensitive OAuth tokens/secrets; do not share the result. Does not change configured credentials.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | string | no | You can set your own ID for the newly created profile if you do not wish to store the auth_token and auth_secret |

#### `add_favorite_recipe`

Add a recipe to a user's favorite.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `recipeId` | string | yes | Unique recipe identifier |

#### `delete_favorite_recipe`

Deletes the specified recipe from the user's favorite.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `recipeId` | string | yes | Unique recipe identifier |

#### `create_saved_meal`

Records a saved meal for the user according to the parameters specified. The result of the call is the new unique identifier of the newly created saved meal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealName` | string | yes | New name of the saved meal |
| `savedMealDescription` | string | no | New description of the saved meal |
| `meals` | string[] | no | Meals the saved meal is suitable for; sent as a comma-separated list. |

#### `delete_saved_meal`

Deletes the specified saved meal for the user.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealId` | string | yes | Unique saved meal identifier |

#### `update_saved_meal`

Records a change to a user's saved meal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealId` | string | yes | Unique saved meal identifier |
| `savedMealName` | string | no | New name of the saved meal |
| `savedMealDescription` | string | no | New description of the saved meal |
| `meals` | string[] | no | Meals the saved meal is suitable for; sent as a comma-separated list. |

#### `add_saved_meal_item`

Adds a food to a user's saved meal according to the parameters specified. The result of the call is the new unique identifier of the newly created saved meal item.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealId` | string | yes | Unique saved meal identifier |
| `foodId` | string | yes | Unique food identifier |
| `savedMealItemName` | string | yes | New name of the saved meal item |
| `servingId` | string | yes | Unique serving identifier |
| `numberOfUnits` | number | yes | Number of units in this standard serving size. For instance, if the serving description is "2 tablespoons" the number of units is "2", while if the serving size is "1 cup" the number of units is "1". Please note that this is only applicable for when food_type is "Generic" whereas for "Brand" the number of units will always be "1" |

#### `delete_saved_meal_item`

Deletes the specified saved meal item for the user.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealItemId` | string | yes | Unique saved meal item identifier |

#### `update_saved_meal_item`

Updates a saved meal item's name or number of units; at least one update required. Serving ID cannot be changed.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealItemId` | string | yes | Unique saved meal item identifier |
| `savedMealItemName` | string | no | New name of the saved meal item |
| `numberOfUnits` | number | no | Number of units in this standard serving size. For instance, if the serving description is "2 tablespoons" the number of units is "2", while if the serving size is "1 cup" the number of units is "1". Please note that this is only applicable for when food_type is "Generic" whereas for "Brand" the number of units will always be "1" |

At least one field is required: `savedMealItemName`, `numberOfUnits`.

#### `update_weight`

Records a user's weight for a nominated date. First weigh-in also requires goalWeightKg and currentHeightCm. Not a substitute for medical advice.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `currentWeightKg` | number | yes | Current weight of the user in kilograms |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |
| `weightType` | string | no | Weight measurement type for this user profile. Valid types are "kg" and "lb" (default value is "kg") Values: `kg`, `lb`. |
| `heightType` | string | no | Height measurement type for this user profile. Valid types are "cm" and "inch" (default value is "cm") Values: `cm`, `inch`. |
| `goalWeightKg` | number | no | User's goal weight in kilograms |
| `currentHeightCm` | number | no | Current height of the user in centimetres. This is required for the first weigh-in. You can only set this for the first time |
| `comment` | string | no | A comment for this weigh-in |

#### `get_user_exercise_entries`

Returns the daily exercise entries for the user on a nominated date.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

#### `get_exercise_month`

Returns the summary estimated daily calories expended for a user's exercise diary entries for the month specified. Use this call to display total energy expenditure information to users about their exercise and activities for a nominated month. Days with no saved exercise diary entries are not included.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

#### `get_exercises`

This is a utility method, returning the full list of all supported exercise type names and their associated unique identifiers.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `create_food`

Creates a food for the user according to the parameters specified. The result of the call is the new unique identifier of the newly created food.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `brandType` | string | yes | Either "manufacturer", "restaurant" or "supermarket" (default value is "manufacturer") Values: `manufacturer`, `restaurant`, `supermarket`. |
| `brandName` | string | yes | Brand name, only when food_type is "Brand". E.G.: "Quaker" |
| `foodName` | string | yes | Name of the food, not including the brand name. E.G.: "Instant Oatmeal" |
| `servingSize` | string | yes | Full description of the serving size. E.G.: "1 serving" |
| `calories` | number | yes | Energy content in kcal |
| `fat` | number | yes | Total fat content in grams |
| `carbohydrate` | number | yes | Total carbohydrate content in grams |
| `protein` | number | yes | Protein content in grams |
| `servingAmount` | string | no | The quantity combined with serving_amount_unit to derive the total standardized quantity of the serving |
| `servingAmountUnit` | string | no | The metric unit of measure for the serving size – either "g" or "ml" or "oz" – combined with metric_serving_amount to derive the total standardized quantity of the serving (default value is "g") Values: `g`, `ml`, `oz`. |
| `caloriesFromFat` | number | no | The energy content in kcal from fat |
| `saturatedFat` | number | no | Saturated fat content in grams (where available) |
| `polyunsaturatedFat` | number | no | Polyunsaturated fat content in grams (where available) |
| `monounsaturatedFat` | number | no | Monounsaturated fat content in grams (where available) |
| `transFat` | number | no | Trans fat content in grams (where available) |
| `cholesterol` | number | no | Cholesterol content in milligrams (where available) |
| `sodium` | number | no | Sodium content in milligrams (where available) |
| `potassium` | number | no | Potassium content in milligrams (where available) |
| `fiber` | number | no | Fiber content in grams (where available) |
| `sugar` | number | no | Sugar content in grams (where available) |
| `addedSugars` | number | no | Added Sugars content in grams (where available) |
| `vitaminD` | number | no | Vitamin D content in micrograms (where available) |
| `vitaminA` | number | no | Vitamin A content in micrograms (where available) |
| `vitaminC` | number | no | Vitamin C content in milligrams (where available) |
| `calcium` | number | no | Calcium content in milligrams (where available) |
| `iron` | number | no | Iron content in milligrams (where available) |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `find_food_by_barcode`

Returns detailed nutritional information for the specified food matching the barcode specified. Barcodes must be specified as GTIN-13 numbers - a 13-digit number filled in with zeros for the spaces to the left. UPC-A, EAN-13 and EAN-8 barcodes may be specified. UPC-E barcodes should be converted to their UPC-A equivalent (and then specified as GTIN-13 numbers).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `barcode` | string | yes | 13-digit GTIN-13 formatted sequence of digits representing the barcode to search against |
| `includeSubCategories` | boolean | no | Response will include the names of all sub categories associated with the food |
| `includeFoodImages` | boolean | no | Response will include food image in the response. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account) |
| `includeFoodAttributes` | boolean | no | Response will include food dietary preferences and allergens if available. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account) |
| `flagDefaultServing` | boolean | no | Either "true" or "false" - the response will flag one of the servings as the default serving (the suggested or most commonly chosen option) |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `get_food_brands`

This is a utility method, returning the list of food brands.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `startsWith` | string | yes | Food brands that begin with the first letter is returned. The "*" will return all food brands beginning with a numeric character. If this is not specified then the most popular food brands at the time is returned |
| `brandType` | string | no | Either "manufacturer", "restaurant" or "supermarket" (default value is "manufacturer") Values: `manufacturer`, `restaurant`, `supermarket`. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `get_food_categories`

This is a utility method, returning the full list of all food categories and their associated unique identifiers.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `get_food_entries_month`

Returns summary daily nutritional information for a user's food diary entries for the month specified. Use this call to display nutritional information to users about their food intake for a nominated month. Days with no food diary entries are not included.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | yes | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

#### `get_food_sub_categories`

This is a utility method, returning the full list of all food sub categories for a food category.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `foodCategoryId` | string | yes | Unique identifier of the food category entry |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `autocomplete_foods`

Returns food elements best matching the search expression specified, ordered by their relevancy to the search expression.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `expression` | string | yes | Suggestions for the given expression is returned. E.G.: "chic" will return up to four of the best suggestions that contains "chic" |
| `maxResults` | integer | no | Maximum number of results to return (default value is 4). This number cannot be greater than 10 Maximum: 10. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |

#### `get_favorite_foods`

Returns the favorite foods for the specified user.

No parameters.

#### `get_most_eaten_foods`

Returns the user's most eaten foods, optionally filtered by meal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `meal` | string | no | Type of meal eaten. Valid meal types are "breakfast", "lunch", "dinner" and "other" Values: `breakfast`, `lunch`, `dinner`, `other`. |

#### `get_recently_eaten_foods`

Returns the user's recently eaten foods, optionally filtered by meal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `meal` | string | no | Type of meal eaten. Valid meal types are "breakfast", "lunch", "dinner" and "other" Values: `breakfast`, `lunch`, `dinner`, `other`. |

#### `recognize_food_image`

Identifies foods and portion sizes in a base64 jpg/png/webp image, returning local database matches. Requires Premier feature access; uses an OAuth1-signed JSON path endpoint.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `imageB64` | string | yes | A Base64 image of one or more foods. This field is limited to 999,982 characters |
| `includeFoodData` | boolean | no | Include full food data in the response (see our food.get API) |
| `eatenFoods` | object[] | no | Previously consumed foods to improve matching. Optional fields should be omitted, not null. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `get_recipe_types`

This is a utility method, returning the full list of all supported recipe type names.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `get_favorite_recipes`

Returns the favorite recipes for the specified user.

No parameters.

#### `get_saved_meal_items`

Returns saved meal items for a specified saved meal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `savedMealId` | string | yes | Unique saved meal identifier |

#### `get_saved_meals`

Returns saved meals for the specified user.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `meal` | string | no | Type of meal eaten. Valid meal types are "breakfast", "lunch", "dinner" and "other" Values: `breakfast`, `lunch`, `dinner`, `other`. |

#### `get_food_v5`

Get detailed v5 food data, including standardized servings, with optional localization/images/attributes. Derived serving ID 0 cannot be used for food_entry.create.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `foodId` | string | yes | Unique food identifier |
| `includeSubCategories` | boolean | no | Response will include the names of all sub categories associated with the food |
| `includeFoodImages` | boolean | no | Response will include food image in the response. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account) |
| `includeFoodAttributes` | boolean | no | Response will include food dietary preferences and allergens if available. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account) |
| `flagDefaultServing` | boolean | no | Either "true" or "false" - the response will flag one of the servings as the default serving (the suggested or most commonly chosen option) |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `search_foods_v5`

Search foods with v5 detailed nutrition, brand/generic filtering, and optional localization/images/attributes. Requires Premier access.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `searchExpression` | string | no | Search expression to match on food names |
| `pageNumber` | integer | no | Zero-based offset into the results for the query |
| `maxResults` | integer | no | Maximum number of results to return (default value is 20). This number cannot be greater than 50 Maximum: 50. |
| `includeSubCategories` | boolean | no | Response will include the names of all sub categories associated with the food |
| `includeFoodImages` | boolean | no | Response will include food image in the response. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account) |
| `includeFoodAttributes` | boolean | no | Response will include food dietary preferences and allergens if available. (Requires separate premier offering, please contact us in order for this feature to be enabled for your account) |
| `flagDefaultServing` | boolean | no | Either "true" or "false" - the response will flag one of the servings as the default serving (the suggested or most commonly chosen option) |
| `foodType` | string | no | Restricts search results to a specific type. Valid values are "none", "generic" or "brand". Defaults to "none" i.e no filter Values: `none`, `generic`, `brand`. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |
| `language` | string | no | (Ignored unless region is also specified) Results will be in the specified language. E.G.: "fr" returns results in French |

#### `get_recipe_v2`

Get recipe v2 details including grams per portion, with optional Premier region localization.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `recipeId` | string | yes | Unique recipe identifier |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |

#### `search_recipes_v3`

Search recipes with v3 recipe-type, image, nutrition/time filters, sorting, and optional Premier region localization.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `recipeTypes` | string[] | no | This option filters by specified recipe types and should be provided as a comma separated string of recipe type names. The values are provided via the api: Recipe Types Get All Sent as a comma-separated list. |
| `recipeTypesMatchall` | boolean | no | This option will affect recipe type filters. If true, a recipe must match all provided recipe types, if false (default) then recipes matching any of the supplied types will be returned, The values are provided via the api: Recipe Types Get All |
| `searchExpression` | string | no | Search expression to match on food names |
| `mustHaveImages` | boolean | no | This option will restrict results to recipes with at least one image |
| `caloriesFrom` | integer | no | Minimum calories that are contained in the recipe |
| `caloriesTo` | integer | no | Maximum calories that are contained in the recipe |
| `carbPercentageFrom` | integer | no | Minimum percentage of the calories composed of carbohydrate |
| `carbPercentageTo` | integer | no | Maximum percentage of the calories composed of carbohydrate |
| `proteinPercentageFrom` | integer | no | Minimum percentage of the calories composed of protein |
| `proteinPercentageTo` | integer | no | Maximum percentage of the calories composed of protein |
| `fatPercentageFrom` | integer | no | Minimum percentage of the calories composed of fat |
| `fatPercentageTo` | integer | no | Maximum percentage of the calories composed of fat |
| `prepTimeFrom` | integer | no | Minimum preparation and cook time in minutes required to create the recipe |
| `prepTimeTo` | integer | no | Maximum preparation and cook time in minutes required to create the recipe |
| `pageNumber` | integer | no | Zero-based offset into the results for the query |
| `maxResults` | integer | no | Maximum number of results to return (default value is 20). This number cannot be greater than 50 Maximum: 50. |
| `sortBy` | string | no | This option will order results. Valid options include: newest, oldest, caloriesPerServingAscending, caloriesPerServingDescending. When not explicitly set, the ordering will be returned by newest Values: `newest`, `oldest`, `caloriesPerServingAscending`, `caloriesPerServingDescending`. |
| `region` | string | no | Results will be filtered by region. E.G.: "FR" returns results from France. If not specified this will default to "US" (United States). Click here for full documentation on localization. |

#### `get_user_food_entries_v2`

Get v2 diary entries by calendar date or a single foodEntryId. Supply at least one lookup field; the description documents alternate lookup despite both rows being marked Required.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |
| `foodEntryId` | string | no | Unique identifier of the food diary entry |

At least one field is required: `date`, `foodEntryId`.

#### `get_weight_month_v2`

Get monthly weight entries using v2 consistent array formatting. Omitted date defaults to the current day on FatSecret.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | YYYY-MM-DD calendar date, converted to days since 1970-01-01. Number of days since January 1, 1970 (default value is the current day) |

## Example Workflow

1. **Setup Credentials:**

   ```
   Tool: set_credentials
   - clientId: "your_client_id"
   - clientSecret: "your_client_secret"
   ```

2. **Search for Foods:**

   ```
   Tool: search_foods
   - searchExpression: "chicken breast"
   ```

3. **Get Food Details:**

   ```
   Tool: get_food
   - foodId: "12345"
   ```

4. **Authenticate User (if needed):**

   ```
   Tool: start_oauth_flow
   - callbackUrl: "oob"

   # Follow the authorization URL, then:

   Tool: complete_oauth_flow
   - requestToken: "from_start_oauth_flow"
   - requestTokenSecret: "from_start_oauth_flow"
   - verifier: "from_authorization_page"
   ```

5. **Add Food to Diary:**
   ```
   Tool: add_food_entry
   - foodId: "12345"
   - servingId: "67890"
   - quantity: 1
   - mealType: "lunch"
   ```

## Configuration Storage

The server stores configuration (credentials and tokens) in `~/.fatsecret-mcp-config.json`. This file contains:

- API credentials (Client ID and Secret)
- OAuth access tokens (when authenticated)
- User ID (when authenticated)

## Security Notes

- Credentials are stored locally in your home directory
- OAuth tokens are securely managed using proper HMAC-SHA1 signing
- All API communications use HTTPS
- The server implements proper OAuth 1.0a security measures

## API Reference

This server implements the FatSecret Platform API. For detailed API documentation, visit:

- [FatSecret Platform API Documentation](https://platform.fatsecret.com/docs/guides)
- [OAuth 1.0a Specification](https://tools.ietf.org/html/rfc5849)

## Error Handling

The server provides detailed error messages for common issues:

- Missing or invalid credentials
- OAuth flow errors
- API rate limiting
- Network connectivity issues
- Invalid parameters

## Testing

### Testing from the Command Line

The project includes several test utilities:

#### 1. Interactive Test Tool

```bash
# Run the interactive test menu
node test-interactive.js
```

This provides a menu-driven interface to test all MCP tools.

#### 2. Date Conversion Test

```bash
# Test the date conversion logic
node test-date-conversion.js
```

Verifies that dates are correctly converted to FatSecret's "days since epoch" format.

#### 3. Direct JSON-RPC Testing

```bash
# Send test messages via pipe
node test-mcp.js | node dist/index.js
```

### Testing in Claude Desktop

1. Restart Claude Desktop after configuring the MCP server
2. Look for "fatsecret" in the available tools
3. Start by using `check_auth_status` to verify the connection

## Troubleshooting

### Common Issues

#### "Invalid integer value: date"
- The FatSecret API expects dates as days since epoch (1970-01-01)
- The server automatically converts YYYY-MM-DD format dates
- If you get this error, ensure you're using the latest version

#### OAuth Authentication Fails
- Verify your Client ID and Client Secret are correct
- Ensure you're using the correct URLs (authentication.fatsecret.com for OAuth)
- Check that you're copying the entire verifier code from the authorization page

#### Server Not Found in Claude
- Ensure the path in your MCP configuration is absolute, not relative
- Verify the server was built successfully (`npm run build`)
- Check Claude's logs for any error messages

#### "User authentication required"
- Complete the OAuth flow using either the CLI utility or MCP tools
- Check authentication status with `check_auth_status` tool
- Tokens are saved in `~/.fatsecret-mcp-config.json`

## Development

To modify or extend the server:

```bash
# Install dependencies
npm install

# Build and run
npm run build
npm start

# Development mode with auto-rebuild
npm run dev
```

### Project Structure

```
fatsecret-mcp/
├── src/
│   ├── index.ts        # Main MCP server implementation
│   └── cli.ts          # OAuth console utility
├── dist/               # Compiled JavaScript files
├── test-*.js           # Test utilities
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT License - see LICENSE file for details.

## Remote (claude.ai) mode

`dist/http.js` serves the data tools over Streamable HTTP at `${PUBLIC_URL}/mcp`, protected by a built-in single-user OAuth 2.1 server (dynamic client registration, authorization code + PKCE, refresh tokens). The set_credentials / OAuth-flow tools and `~/.fatsecret-mcp-config.json` are not used in this mode; FatSecret credentials come from env only.

Run it with `npm run build && npm run start:http`, or use the `production` stage of the `Dockerfile`. Variables are documented in `.example.env`:

| Variable | Purpose |
| --- | --- |
| `CLIENT_ID`, `CLIENT_SECRET` | FatSecret app credentials |
| `ACCESS_TOKEN`, `ACCESS_TOKEN_SECRET` | FatSecret user tokens |
| `AUTH_PASSWORD` | Password for the login form shown on connect |
| `PUBLIC_URL` | Public base URL (OAuth issuer), e.g. `https://fatsecret.example.com` |
| `DATA_DIR` | Directory for `auth.db` (default `./data`) |
| `PORT` | Listen port (default `8080`) |
| `LOG_LEVEL` | pino level (default `info`) |

Get `ACCESS_TOKEN` and `ACCESS_TOKEN_SECRET` by running `node dist/cli.js` locally and completing the FatSecret login. The values are written to `~/.fatsecret-mcp-config.json`.

In claude.ai, add a custom connector with the URL `${PUBLIC_URL}/mcp` and enter `AUTH_PASSWORD` when prompted. `GET /health` and `GET /metrics` (Prometheus) need no auth.
