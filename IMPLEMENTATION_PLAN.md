# Implementation Plan - Performance Improvement App

## Architecture Overview

```
performance-improvement-app/
├── app/                          # React Router Admin App
│   ├── routes/
│   │   ├── app._index.jsx        # Dashboard - list scripts
│   │   ├── app.scripts.new.jsx   # Create script form
│   │   ├── app.scripts.$id.jsx   # Edit script
│   │   └── app.settings.jsx      # Global settings
│   ├── components/
│   │   ├── ScriptForm.jsx        # Reusable form component
│   │   ├── ScriptList.jsx        # Table/list view
│   │   └── ScriptCard.jsx        # Individual script card
│   ├── lib/
│   │   ├── metaobjects.js        # GraphQL queries/mutations
│   │   └── shopify.js            # Shopify API helpers
│   └── shopify.server.js         # Auth/session config
├── extensions/
│   └── script-injector/          # Theme App Extension
│       ├── shopify.extension.toml
│       ├── blocks/
│       │   └── head-script.liquid
│       ├── assets/
│       │   └── script-loader.js
│       └── locales/
│           └── en.default.json
├── prisma/
│   └── schema.prisma             # Session storage only
└── shopify.app.toml              # App config + metaobject definitions
```

---

## Critical Fixes & Notes (Must Read Before Starting)

### 1. Metaobject Schema Format
**Use `[[metaobject_definitions]]` not `[[metaobjects]]`** — see Task 1.1 for correct TOML structure.

### 2. Theme App Extension Block Caching
**Blocks are cached by default.** Must fetch fresh metaobject data via `shop.metaobjects.type[gid]` in Liquid — see Task 3.2 for pattern.

### 3. Script Tag API Deprecation
> ⚠️ **Script Tag API is deprecated (sunset March 2027).**
> This app uses **Theme App Extensions** (modern approach). Scripts are managed via the **theme editor**, not the app admin directly. Merchants add/configure blocks in Online Store → Themes → Customize.

### 4. Prisma Session Model — Already Exists
The `prisma/schema.prisma` already has the correct `Session` model with all required fields. **No changes needed.**

### 5. Webhook Configuration — Already Exists
`shopify.app.toml` already contains:
```toml
[webhooks]
api_version = "2026-10"

[[webhooks.subscriptions]]
uri = "/webhooks/app/uninstalled"
topics = [ "app/uninstalled" ]

[[webhooks.subscriptions]]
uri = "/webhooks/app/scopes_update"
topics = [ "app/scopes_update" ]
```
Task 4.2 only needs to implement the **handler logic** in `app/routes/webhooks.app.uninstalled.jsx`.

---

## Phase 1: Data Layer & Metaobjects (Backend)

### Task 1.1: Define Metaobject Definitions
**File:** `shopify.app.toml` (extend existing)

**Prompt for AI:**
> Add metaobject definitions to `shopify.app.toml` using the **correct format** (`[[metaobject_definitions]]`):
>
> ```toml
> [[metaobject_definitions]]
> name = "Script"
> type = "script_injector_script"
> fields = [
>   { key = "name", type = "single_line_text_field", required = true },
>   { key = "code", type = "multi_line_text_field", required = true },
>   { key = "enabled", type = "boolean", required = true, default = true },
>   { key = "target_pages", type = "list.single_line_text_field" },
>   { key = "custom_page_handles", type = "list.single_line_text_field" },
>   { key = "position", type = "single_line_text_field" },  # 'head' | 'body_start' | 'body_end'
>   { key = "priority", type = "integer", required = true, default = 0 },
>   { key = "async", type = "boolean", default = false },
>   { key = "defer", type = "boolean", default = true }
> ]
>
> [[metaobject_definitions]]
> name = "Config"
> type = "script_injector_config"
> fields = [
>   { key = "auto_inject", type = "boolean", default = false },
>   { key = "debug_mode", type = "boolean", default = false }
> ]
> ```
>
> **Important:** Use `[[metaobject_definitions]]` (plural), not `[[metaobjects]]`. Type must use underscores (`script_injector_script`). Added `custom_page_handles` field for custom page targeting. Follow existing access control patterns in the file.

---

### Task 1.2: GraphQL Operations Library
**File:** `app/lib/metaobjects.js`

**Prompt for AI:**
> Create a GraphQL operations library with these functions:
> - `getScripts(session)` - fetch all scripts for shop
> - `getScript(session, id)` - fetch single script
> - `createScript(session, input)` - create new script metaobject
> - `updateScript(session, id, input)` - update script
> - `deleteScript(session, id)` - delete script
> - `reorderScripts(session, scriptIds)` - update priority order
> - `getGlobalConfig(session)` - fetch app config
> - `updateGlobalConfig(session, input)` - update config
>
> Use `@shopify/shopify-app-react-router` authenticated admin API. Return typed TypeScript interfaces.

---

### Task 1.3: TypeScript Types
**File:** `app/types/script.ts`

**Prompt for AI:**
> Define TypeScript interfaces matching the metaobject schema:
> - `ScriptMetaobject` - id, name, code, enabled, targetPages, customPageHandles, position, priority, async, defer, createdAt, updatedAt
> - `ScriptInput` - for create/update mutations (include async, defer, customPageHandles)
> - `GlobalConfig` - autoInject, debugMode
> - `TargetPage` enum: 'all', 'home', 'product', 'collection', 'cart', 'checkout', 'custom'
> - `Position` enum: 'head', 'body_start', 'body_end'

---

## Phase 2: Admin UI - Core Routes (Frontend)

### Task 2.1: Dashboard Route - Script List
**File:** `app/routes/app._index.jsx`

**Prompt for AI:**
> Build a Polaris IndexTable displaying all scripts with columns:
> - Name (link to edit)
> - Status badge (enabled/disabled)
> - Target pages (chips)
> - Position (head/body)
> - Priority (sortable drag-handle)
> - Actions: Edit, Delete, Toggle enable
>
> Empty state: "No scripts yet" + PrimaryButton "Add Script" → `/app/scripts/new`
> Use `useLoaderData` for scripts, `useFetcher` for delete/toggle actions.

---

### Task 2.2: Script Form Component (Reusable)
**File:** `app/components/ScriptForm.jsx`

**Prompt for AI:**
> Create a reusable Polaris form component with fields:
> - Name (TextField, required)
> - Code (TextArea, required, monospace, syntax highlighting hint)
> - Enabled (ToggleSwitch)
> - Position (Select: head, body_start, body_end)
> - Async (ToggleSwitch, default false) — renders `async` attribute
> - Defer (ToggleSwitch, default true) — renders `defer` attribute
> - Target Pages (MultiSelect with chips: all, home, product, collection, cart, checkout, custom)
> - Custom Page Handles (TextArea, conditional - show when 'custom' selected, comma-separated page handles like `/pages/about`, `/blogs/news`)
> - Priority (NumberField, hidden, auto-assigned)
>
> Props: `initialData?`, `onSubmit`, `onCancel`, `isLoading`, `errors`
> Validate: name unique, code not empty, valid JS syntax (basic check)

---

### Task 2.3: Create Script Route
**File:** `app/routes/app.scripts.new.jsx`

**Prompt for AI:**
> Build create route using ScriptForm component.
> Loader: check permissions, redirect if not authenticated.
> Action: call createScript mutation, redirect to edit page on success.
> Show toast notifications for success/error.

---

### Task 2.4: Edit Script Route
**File:** `app/routes/app.scripts.$id.jsx`

**Prompt for AI:**
> Build edit route with loader fetching script by ID.
> Use same ScriptForm component pre-filled.
> Action: updateScript mutation.
> Add delete button (danger) with confirmation modal.
> Add "Duplicate" button (creates copy with "Copy of " prefix).

---

### Task 2.5: Settings Route
**File:** `app/routes/app.settings.jsx`

**Prompt for AI:**
> Build settings page with:
> - Global toggle: "Auto-inject scripts on all pages" (updates config metaobject)
> - Debug mode toggle (adds console.log to injected scripts)
> - Theme app extension install status indicator
> - Links to Shopify theme editor deep link
> - Danger zone: "Reset all data" (deletes all scripts + config)

---

### Task 2.6: Navigation & Layout
**Files:** `app/routes/app.jsx`, `app/root.jsx`

**Prompt for AI:**
> Update app.jsx sidebar navigation with:
> - Dashboard (scripts list)
> - Add Script
> - Settings
>
> Ensure Polaris Page/Layout structure with proper breadcrumbs.
> Add resource picker for multi-shop support if needed.

---

## Phase 3: Theme App Extension (Frontend - Storefront)

### Task 3.1: Extension Configuration
**File:** `extensions/script-injector/shopify.extension.toml`

**Prompt for AI:**
> Create theme app extension config with **three block types** for different injection positions:
> ```toml
> name = "Script Injector"
> type = "theme_app_extension"
> version = "1.0.0"
> 
> [[blocks]]
> name = "Head Script"
> type = "head_script"
> target = "head"
> settings = [
>   { key = "script_id", type = "metaobject_reference", required = true, metaobject_type = "script_injector_script" },
>   { key = "custom_code", type = "liquid", required = false }
> ]
>
> [[blocks]]
> name = "Body Start Script"
> type = "body_start_script"
> target = "body_start"
> settings = [
>   { key = "script_id", type = "metaobject_reference", required = true, metaobject_type = "script_injector_script" },
>   { key = "custom_code", type = "liquid", required = false }
> ]
>
> [[blocks]]
> name = "Body End Script"
> type = "body_end_script"
> target = "body_end"
> settings = [
>   { key = "script_id", type = "metaobject_reference", required = true, metaobject_type = "script_injector_script" },
>   { key = "custom_code", type = "liquid", required = false }
> ]
>
> [settings_schema]
> # No section-level settings
> ```
>
> **Key:** Use `metaobject_reference` type for `script_id` with `metaobject_type = "script_injector_script"` to enable the metaobject picker in theme editor.

---

### Task 3.2: Script Block Templates (3 positions)
**Files:** 
- `extensions/script-injector/blocks/head-script.liquid`
- `extensions/script-injector/blocks/body-start-script.liquid`
- `extensions/script-injector/blocks/body-end-script.liquid`

**Prompt for AI:**
> Create **three Liquid block templates** (one per position) that handle **Shopify's block caching** properly:
>
> **All three share the same core logic** — only the rendering position differs (handled by block `target` in config):
>
> ```liquid
> {% comment %}
>   This block is cached by default. To ensure script updates reflect immediately,
>   use block.settings.script_id to fetch fresh data from metaobjects.
> {% endcomment %}
>
> {% assign script_gid = block.settings.script_id %}
> {% assign script = shop.metaobjects.script_injector_script[script_gid] %}
>
> {% if script and script.enabled.value == true %}
>   {% comment %} Verify script.position matches this block's target {% endcomment %}
>   {% assign expected_position = 'head' %}{% comment %} Change to 'body_start' or 'body_end' per file {% endcomment %}
>   {% if script.position.value == expected_position %}
>     {% assign target_pages = script.target_pages.value | split: ',' %}
>     {% assign current_page_match = false %}
>     
>     {% if target_pages contains 'all' or target_pages contains template.name %}
>       {% assign current_page_match = true %}
>     {% elsif target_pages contains 'custom' %}
>       {% assign custom_handles = script.custom_page_handles.value | split: ',' %}
>       {% if custom_handles contains request.path %}
>         {% assign current_page_match = true %}
>       {% endif %}
>     {% endif %}
>
>     {% if current_page_match %}
>       <script
>         data-script-id="{{ script.id }}"
>         data-priority="{{ script.priority.value }}"
>         {% if script.async.value %}async{% endif %}
>         {% if script.defer.value %}defer{% endif %}
>         {% if content_for_header contains 'nonce-' %}
>           nonce="{{ content_for_header | split: 'nonce-' | last | split: '"' | first }}"
>         {% endif %}
>       >
>         {{ script.code.value }}
>       </script>
>     {% endif %}
>   {% endif %}
> {% endif %}
> ```
>
> **Key points:**
> - Access metaobject via `shop.metaobjects.script_injector_script[gid]` (bypasses block cache)
> - Verify `script.position.value` matches block's target (`head`/`body_start`/`body_end`)
> - Check `enabled` boolean value
> - Match target pages against `template.name` and custom handles
> - Support `async`/`defer` from metaobject fields
> - Extract CSP nonce from `content_for_header`
> - Graceful degradation: skip rendering if script missing/disabled/position mismatch
> - Use `block.settings.custom_code` as fallback/override if provided

---

### Task 3.3: Script Loader Asset (Optional Enhancement)
**File:** `extensions/script-injector/assets/script-loader.js`

**Prompt for AI:**
> Create a lightweight vanilla JS module that:
> - Loads scripts in priority order
> - Supports async/defer
> - Handles script errors without blocking page
> - Exposes `window.ScriptInjector.load(scriptConfig)` for dynamic loading
> - ~2KB minified, no dependencies

---

### Task 3.4: Localization
**File:** `extensions/script-injector/locales/en.default.json`

**Prompt for AI:**
> Add English translations for:
> - Block name: "Head Script"
> - Setting labels: "Script", "Custom Code"
> - Setting help text explaining each field
> - Error messages for missing/invalid scripts

---

## Phase 4: Integration & Polish

### Task 4.1: Admin → Theme Editor Deep Link
**File:** `app/lib/shopify.js` (add function)

**Prompt for AI:**
> Add function `getThemeEditorDeepLink(shop, blockId?)` that returns URL:
> `https://{shop}/admin/themes/editor?context=app&app_block_id={blockId}`
> Use in Settings page and script list "Open in Theme Editor" buttons.

---

### Task 4.2: Webhook Handlers (Cleanup)
**Files:** `app/routes/webhooks.app.uninstalled.jsx`

**Prompt for AI:**
> Update uninstall webhook to:
> - Delete all script metaobjects for the shop
> - Delete config metaobject
> - Log cleanup for debugging

---

### Task 4.3: App Install/Onboarding Flow
**Files:** `app/routes/auth.$.jsx`, `app/routes/app._index.jsx` (loader)

**Prompt for AI:**
> Ensure onboarding:
> 1. After OAuth, check if config metaobject exists
> 2. If not, create default config + redirect to Settings with welcome banner
> 3. Show "Get Started" CTA linking to theme editor with pre-selected block
> 4. Use `useEffect` + `shopifyAppBridge` to navigate merchant to theme editor

---

### Task 4.4: Drag-and-Drop Reordering
**Files:** `app/components/ScriptList.jsx`, `app/routes/app._index.jsx` (action)

**Prompt for AI:**
> Add @dnd-kit/sortable to ScriptList:
> - Rows draggable by handle
> - On drop, call reorderScripts mutation with new priority array
> - Optimistic UI update
> - Persist order to metaobject priority field

---

### Task 4.5: Error Boundaries & Loading States
**Files:** All routes

**Prompt for AI:**
> Add:
> - React ErrorBoundary wrapper per route
> - Skeleton loaders for table/forms
> - Toast notifications for all mutations
> - Retry buttons for failed loads

---

## Phase 5: Testing & Validation

### Task 5.1: TypeScript Type Check
**Command:** `npm run typecheck`

### Task 5.2: Lint & Format
**Commands:** `npm run lint`, `npx prettier --check .`

### Task 5.3: GraphQL Validation
**Prompt for AI:**
> Validate all GraphQL operations against Shopify Admin API 2026-10 schema using `shopify-dev_validate_graphql_codeblocks` tool.

### Task 5.4: Component Validation
**Prompt for AI:**
> Validate all Polaris components using `shopify-dev_validate_component_codeblocks` tool.

---

## Prompts for Splitting Work

### For UI/Design AI:
> "Design Polaris-based admin UI for a Shopify app that manages script injection. Components needed: ScriptForm (complex form with code editor, toggles, multi-select), ScriptList (sortable table with status chips, inline actions), Dashboard empty/loading/error states, Settings page with toggles and deep links. Follow Shopify Polaris design system, use IndexTable, Card, Modal, Toast patterns. Output: Figma-compatible component specs or React+Polaris JSX."

### For Backend/GraphQL AI:
> "Build GraphQL operations for Shopify Admin API 2026-10 managing metaobjects: script_injector.script (name, code, enabled, target_pages, position, priority) and script_injector.config (auto_inject, debug_mode). Operations: CRUD + reorder. Use authenticated session from @shopify/shopify-app-react-router. Output: TypeScript functions with typed responses."

### For Theme Extension AI:
> "Create Shopify Theme App Extension (Liquid) that injects <script> tags into <head> based on metaobject data.
> 
> **Critical requirements:**
> - Block receives `script_id` (metaobject GID) via block setting
> - **Must bypass block cache**: fetch fresh data via `shop.metaobjects.script_injector_script[gid]`
> - Check `enabled` boolean, match `target_pages` against `template.name` and custom handles
> - Render `<script>` with `data-script-id`, `data-priority`, `async`/`defer` from metaobject fields
> - Extract CSP nonce from `content_for_header`
> - Graceful degradation: skip if script missing/disabled/page doesn't match
> - Support `head`, `body_start`, `body_end` positions (block target config)
> 
> Output: shopify.extension.toml, blocks/head-script.liquid, blocks/body-start-script.liquid, blocks/body-end-script.liquid, locales/en.default.json."

---

## Dependency Order

```
1.1 → 1.2 → 1.3 (Data layer first)
     ↓
2.1, 2.2, 2.3, 2.4, 2.5, 2.6 (Admin UI - can parallelize)
     ↓
3.1, 3.2, 3.3, 3.4 (Theme Extension - parallel to Admin UI)
     ↓
4.1, 4.2, 4.3, 4.4, 4.5 (Integration)
     ↓
5.1, 5.2, 5.3, 5.4 (Validation)
```

---

## Estimated Effort per Task

| Task | Hours | Type |
|------|-------|------|
| 1.1 Metaobject defs | 0.5 | Config |
| 1.2 GraphQL lib | 1.5 | Backend |
| 1.3 Types | 0.5 | Types |
| 2.1 Dashboard | 1.0 | Frontend |
| 2.2 ScriptForm | 1.5 | Frontend |
| 2.3 Create route | 0.5 | Frontend |
| 2.4 Edit route | 0.5 | Frontend |
| 2.5 Settings | 0.5 | Frontend |
| 2.6 Navigation | 0.5 | Frontend |
| 3.1 Extension config | 0.5 | Liquid |
| 3.2 Block template | 1.0 | Liquid |
| 3.3 Script loader | 0.5 | JS |
| 3.4 Locales | 0.25 | Config |
| 4.1 Deep links | 0.25 | Integration |
| 4.2 Webhooks | 0.25 | Backend |
| 4.3 Onboarding | 0.5 | Frontend |
| 4.4 Drag-drop | 1.0 | Frontend |
| 4.5 Error/Loading | 0.5 | Frontend |
| 5.x Validation | 1.0 | QA |
| **Total** | **~12h** | |

---

## Next Steps

1. Start with **Phase 1** (data layer) - enables everything else
2. **Phase 2 & 3** can run in parallel (separate AIs)
3. **Phase 4** integrates both
4. **Phase 5** validates before handoff

Would you like me to begin with Phase 1?