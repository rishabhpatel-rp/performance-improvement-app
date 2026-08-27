# Implementation Plan v3 - Performance Improvement App (Simplified, Corrected)

## Overview
Replaces the flexible script-management system with a **simplified 3-step wizard dashboard**
and **3 pre-defined, hardcoded scripts** that inject only into `<head>`.

This is a revision of `IMPLEMENTATION_PLAN_2.md`. Changes from v2 are marked **[FIX]**.

**Assumptions made in this revision (confirm before building):**
- Each toggle/textarea change saves immediately via `useFetcher` submit, rather than
  batching everything until "Save & Complete" on Step 3. This avoids losing changes if
  the merchant navigates away mid-wizard.
- Dashboard styling follows `Desing_plan.md`'s look (custom colors/stepper/cards) built
  with custom CSS inside the app's own route, layered on top of the existing Polaris
  web-component shell (`<s-page>` etc.) rather than a from-scratch non-Polaris page. It
  will look visually distinct from the rest of Shopify admin — that's expected given the
  reference design.

---

## Architecture Changes

### Old (Removed)
- User-created scripts with full CRUD
- Position selection (head/body_start/body_end)
- Target pages, async, defer, priority
- Drag-and-drop reordering
- `ScriptForm` component with complex fields

### New (Simplified)
- **3 pre-defined scripts** (hardcoded, sourced from the real code already written in
  `extensions/script-injector/assets/scriptlist.js`) **[FIX: v2 used empty placeholder
  code — must use the real payloads]**
- **Single activation toggle** (app on/off)
- **3 toggles** (one per script)
- **Textarea for script titles** (array of strings, display labels only — never touches
  the injected code)
- All scripts inject to **`<head>` only**
- Theme extension has exactly **one** app-embed block, no merchant-facing settings
  **[FIX: v2 required a manual metaobject picker — removed]**

---

## Phase 1: Data Layer & Metaobjects (Backend)

### Task 1.1: Update Metaobject Definitions
**File:** `shopify.app.toml`

- Remove `[metaobjects.app.script_injector_script]` entirely (old CRUD scripts).
- Replace `[metaobjects.app.script_injector_config]` with:

```toml
[metaobjects.app.script_injector_config]
name = "Config"
description = "Script injector configuration"

[metaobjects.app.script_injector_config.access]
admin = "merchant_read_write"

[metaobjects.app.script_injector_config.fields.app_enabled]
name = "App Enabled"
type = "boolean"

[metaobjects.app.script_injector_config.fields.script_1_enabled]
name = "Script 1 Enabled"
type = "boolean"

[metaobjects.app.script_injector_config.fields.script_2_enabled]
name = "Script 2 Enabled"
type = "boolean"

[metaobjects.app.script_injector_config.fields.script_3_enabled]
name = "Script 3 Enabled"
type = "boolean"

[metaobjects.app.script_injector_config.fields.script_titles]
name = "Script Titles"
type = "list.single_line_text_field"

[metaobjects.app.script_injector_config.fields.debug_mode]
name = "Debug Mode"
type = "boolean"
```

**[FIX] Removed `auto_inject`** — it's redundant with `app_enabled` (v2's Step 1 renamed
"auto inject" to "app enabled" but the old field was never dropped).

**[FIX — data migration note]** If this app has already been deployed to a live shop and
`script_injector_script` metaobjects exist with real merchant data, removing the
definition from `shopify.app.toml` does **not** automatically delete the remote
definition or its entries. Confirm whether any real data exists before deploy; if so,
either export it first or explicitly delete the definition via the Admin API/CLI before
redeploying, otherwise you'll have an orphaned, unused metaobject type sitting on the shop.

### Task 1.2: Pre-defined Scripts (Real Code, Not Placeholders)
**File:** `app/lib/scripts.ts` (new)

**[FIX — critical]** v2 shipped placeholder comments (`// Add your code here`). The real
payloads already exist in `extensions/script-injector/assets/scriptlist.js`:

1. **Script 1 ("Audit script")** — a `<script>` payload. Type: `script`.
2. **Script 2 ("Work script")** — a `<script>` payload (script-gating / third-party
   blocking logic). Type: `script`.
3. **Script 3 ("Work css")** — currently an *empty* `<style></style>` block. Type: `style`,
   **not** `script`. **[FIX]** v2 treated all three uniformly as `<script>` — this one must
   render as `<style>` or it will silently do nothing.

```typescript
export const PREDEFINED_SCRIPTS = [
  {
    id: 'script_1',
    name: 'Audit Script',
    type: 'script', // rendered as <script>...</script>
    code: `/* verbatim payload copied from scriptlist.js item 1 */`,
    defaultEnabled: false,
  },
  {
    id: 'script_2',
    name: 'Work Script',
    type: 'script', // rendered as <script>...</script>
    code: `/* verbatim payload copied from scriptlist.js item 2 */`,
    defaultEnabled: false,
  },
  {
    id: 'script_3',
    name: 'Work CSS',
    type: 'style', // rendered as <style>...</style>
    code: `/* verbatim payload copied from scriptlist.js item 3 */`,
    defaultEnabled: false,
  },
] as const;
```

Copy the exact minified bodies from `scriptlist.js` into `code` — do not paraphrase or
re-type them by hand (risk of introducing bugs in obfuscated/minified logic).

### Task 1.3: Simplified GraphQL Operations
**File:** `app/lib/metaobjects.ts` (replace)

Remove: `getScripts`, `getScript`, `createScript`, `updateScript`, `deleteScript`,
`reorderScripts`, `deleteAllScriptsForShop`.

Keep/rewrite:
- `getConfig(request)` — fetch the singleton config metaobject.
- `updateConfig(request, input)` — partial update (single toggle, single field, or all
  at once — must support saving one field at a time per the auto-save assumption above).
- `ensureConfig(request)` — onboarding: creates the config metaobject with all fields
  `false`/empty if none exists yet.

**[FIX — was missing in v2]** Explicitly rewrite `mapConfigFields` to map the new
snake_case metaobject keys to the camelCase `AppConfig` shape:

```
app_enabled       -> appEnabled
script_1_enabled  -> script1Enabled
script_2_enabled  -> script2Enabled
script_3_enabled  -> script3Enabled
script_titles     -> scriptTitles   // already an array; do not split as a string
debug_mode        -> debugMode
```

And the reverse mapping in `updateConfig` when writing fields back. `script_titles` is a
`list.single_line_text_field` — write it as an array of strings directly (GraphQL list
input), not a joined/delimited string.

### Task 1.4: Simplified TypeScript Types
**File:** `app/types/script.ts` (replace)

```typescript
export interface AppConfig {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  scriptTitles: string[]; // one entry per script, in order [title1, title2, title3]
  debugMode: boolean;
}

export interface AppConfigInput {
  appEnabled?: boolean;
  script1Enabled?: boolean;
  script2Enabled?: boolean;
  script3Enabled?: boolean;
  scriptTitles?: string[];
  debugMode?: boolean;
}

export interface PredefinedScript {
  id: 'script_1' | 'script_2' | 'script_3';
  name: string;
  type: 'script' | 'style'; // [FIX] added — needed to pick the right wrapper tag
  code: string;
  defaultEnabled: boolean;
}
```

---

## Phase 2: Dashboard UI - 3-Step Wizard (Frontend)

### Task 2.1: Dashboard Route - Wizard Container
**File:** `app/routes/app._index.jsx` (replace)

**State:** `currentStep` (1, 2, 3) — local UI state only; does not gate persistence.

**Loader:** Fetch config via `getConfig` (calls `ensureConfig` first if none exists).

**UI Structure:**
```
<s-page heading="Performance Improvement">
  <WizardProgress steps={['Start', 'Preview', 'Finish']} currentStep={currentStep} />

  {currentStep === 1 && <Step1Activate config={config} />}
  {currentStep === 2 && <Step2Configure config={config} />}
  {currentStep === 3 && <Step3Titles config={config} />}

  <WizardNavigation currentStep={currentStep} onChange={setCurrentStep} />
</s-page>
```

Step labels follow `Desing_plan.md`'s stepper copy ("Start" / "Preview" / "Finish").

### Task 2.2: Step 1 - Activate App
**Component:** `app/components/Step1Activate.jsx` (new)

- Single toggle: "Enable Performance Improvement App" (`app_enabled`).
- **[FIX]** Toggle change submits immediately via `useFetcher` (`intent: "toggle-app"`) —
  does not wait for a later save step.
- "Continue" advances to Step 2 (UI-only navigation; no separate save action needed since
  the toggle already persisted).

### Task 2.3: Step 2 - Configure Scripts
**Component:** `app/components/Step2Configure.jsx` (new)

- App description paragraph (static copy).
- 3 toggle switches, one per predefined script, labeled with the current title from
  `config.scriptTitles[i]` (falling back to the script's default `name`).
- Each toggle submits immediately on change (`intent: "toggle-script"`, `scriptIndex`).
- Toggles are disabled (greyed out) if `app_enabled` is false, with a short note
  ("Enable the app in Step 1 first").
- "Back" / "Continue" buttons (navigation only).

### Task 2.4: Step 3 - Script Titles
**Component:** `app/components/Step3Titles.jsx` (new)

- Textarea, pre-filled from `config.scriptTitles.join('\n')`.
- Placeholder: "Enter a title for each script, one per line, in order."
- Help text clarifies these are **labels only** — used in the dashboard and (optionally)
  as `data-*` identifiers, and never alter the injected code itself.
- On blur/submit: split textarea value on `\n`, trim empty lines, cap/pad to exactly 3
  entries, save as `scriptTitles` array (`intent: "save-titles"`).
- "Back" / "Done" button. **[FIX]** Renamed from "Save & Complete" since saving already
  happened per-field — this button just confirms/exits the wizard.

### Task 2.5: Wizard Navigation Component
**Component:** `app/components/WizardNavigation.jsx` (new)

- Previous/Next (or "Done" on step 3) — pure UI step navigation.
- No longer responsible for the actual save (each step's inputs save themselves).

### Task 2.6: Wizard Progress Indicator
**Component:** `app/components/WizardProgress.jsx` (new)

- Visual 3-circle stepper matching `Desing_plan.md`: active/completed = `#00B856`
  filled circle, inactive = `#E2E7EC`, connected by a `2px` `#E0E0E0` line.
- Clickable to jump between steps freely (all steps are always fully populated/valid
  since there's no "invalid intermediate state" — every field has a safe default).

---

## Phase 3: Theme App Extension (Storefront)

### Task 3.1: Extension Config — no changes needed
**File:** `extensions/script-injector/shopify.extension.toml`

**[FIX]** v2 proposed a `[[blocks]]` array with a `metaobject_reference` setting inside
this toml file. Theme app extension blocks are **not** declared this way — they're
auto-discovered from `.liquid` files under `/blocks` via each file's own `{% schema %}`
tag, exactly like the existing `app-embed-head.liquid` already does. This file stays as-is
(name/type/version/uid only); no edits needed here.

### Task 3.2: Repurpose the Existing Head Block (Not a New File)
**File:** `extensions/script-injector/blocks/app-embed-head.liquid` (replace in place)

**[FIX]** v2 created a brand-new `performance-scripts.liquid` file and left
`app-embed-head.liquid` untouched. Since both would target `head`, the merchant would end
up with **two separate app-embed toggles** in Theme Editor → one dead (referencing the
now-deleted `script_injector_script` type), one live. Instead, replace the contents of
the existing file so there is exactly one app-embed block, with the same name the
merchant may have already enabled.

**[FIX]** No settings/metaobject picker — matches the existing file's "merchant enables
this ONCE, zero further configuration" pattern. Fetch the singleton config the same way
the current file fetches script lists (`shop.metaobjects.<type>.values`, take the first).

**[FIX]** `script_titles` is already an array in Liquid (list-type field) — don't
`split: '\n'` it again. Script 3 renders as `<style>`, not `<script>`.

```liquid
{% comment %}
  App Embed block (target: head). No settings — merchant enables this ONCE in
  Theme Editor > App embeds. Reads the shop's single config metaobject and injects
  whichever predefined scripts are toggled on, straight into <head>.
{% endcomment %}

{% assign config = shop.metaobjects.script_injector_config.values | first %}

{% if config and config.app_enabled.value == true %}
  {% assign titles = config.script_titles.value %}

  {% if config.script_1_enabled.value == true %}
    <script data-script-id="script_1"
      {% if content_for_header contains 'nonce-' %}
        nonce="{{ content_for_header | split: 'nonce-' | last | split: '"' | first }}"
      {% endif %}>
      /* verbatim Script 1 payload */
    </script>
  {% endif %}

  {% if config.script_2_enabled.value == true %}
    <script data-script-id="script_2"
      {% if content_for_header contains 'nonce-' %}
        nonce="{{ content_for_header | split: 'nonce-' | last | split: '"' | first }}"
      {% endif %}>
      /* verbatim Script 2 payload */
    </script>
  {% endif %}

  {% if config.script_3_enabled.value == true %}
    <style data-script-id="script_3">
      /* verbatim Script 3 (CSS) payload */
    </style>
  {% endif %}
{% endif %}

{% schema %}
{
  "name": "Performance Scripts",
  "target": "head",
  "settings": []
}
{% endschema %}
```

Titles (`titles[0]`, `titles[1]`, `titles[2]`) are **not referenced in this file at all**
— they're dashboard-only labels, never rendered into the storefront output.

### Task 3.3: Update Locales
**File:** `extensions/script-injector/locales/en.default.json` (replace)

```json
{
  "blocks": {
    "performance_scripts": {
      "name": "Performance Scripts"
    }
  }
}
```

No settings strings needed since there are no settings.

---

## Phase 4: Cleanup & Integration

### Task 4.1: Remove Unused Files
Delete:
- `app/routes/app.scripts.new.jsx`
- `app/routes/app.scripts.$id.jsx`
- `app/components/ScriptForm.jsx`
- `app/components/ScriptList.jsx`
- `extensions/script-injector/blocks/head-script.liquid`
- `extensions/script-injector/blocks/body-start-script.liquid`
- `extensions/script-injector/blocks/body-end-script.liquid`

**[FIX]** `app-embed-head.liquid` is **not** deleted — it's repurposed in Task 3.2, so it
should not appear in both a "keep" and "delete" list as it did ambiguously in v2.

### Task 4.2: Update Navigation
**File:** `app/routes/app.jsx`

Sidebar: Dashboard (wizard) + Settings only.

### Task 4.3: Update Settings Page
**File:** `app/routes/app.settings.jsx` (simplify)

Keep: Debug mode toggle, theme editor deep link, danger-zone reset.
Remove: Auto-inject toggle (fully superseded by Step 1's `app_enabled`).

### Task 4.4: Webhook Handler
**File:** `app/routes/webhooks.app.uninstalled.jsx`

Keep existing cleanup logic (delete config metaobject on uninstall).

---

## Phase 5: Validation & Polish

1. `npm run typecheck`
2. `npm run lint`, `npx prettier --check .`
3. `shopify theme check` in the extension folder — confirm no stale references to
   `script_injector_script` remain anywhere in `/extensions`.
4. `shopify app dev` manual pass:
   - Wizard flows 1→2→3, each toggle persists on change (reload mid-wizard, confirm state
     survives).
   - Theme Editor shows exactly **one** app-embed toggle for this app, no orphaned ones.
   - With app enabled + all 3 toggled on: confirm both `<script>` tags and the `<style>`
     tag land in `<head>` (view source), and the audit/work scripts actually run as they
     did in their original standalone form.
   - Titles entered in Step 3 show correctly as toggle labels in Step 2 on reload, and are
     never present in the storefront's rendered `<head>` output.

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `app/lib/scripts.ts` | Real predefined script/style payloads |
| `app/components/Step1Activate.jsx` | Step 1: app toggle |
| `app/components/Step2Configure.jsx` | Step 2: 3 script toggles |
| `app/components/Step3Titles.jsx` | Step 3: titles textarea |
| `app/components/WizardProgress.jsx` | Step indicator |
| `app/components/WizardNavigation.jsx` | Prev/Next/Done buttons |

### Modified Files
| File | Changes |
|------|---------|
| `shopify.app.toml` | New config metaobject fields, old script type removed |
| `app/lib/metaobjects.ts` | Config-only ops, explicit field mapping |
| `app/types/script.ts` | New simplified types (incl. script `type`) |
| `app/routes/app._index.jsx` | Wizard container |
| `app/routes/app.settings.jsx` | Minimal settings |
| `app/routes/app.jsx` | Simplified navigation |
| `extensions/script-injector/blocks/app-embed-head.liquid` | Repurposed for new config-driven logic (not replaced by a new file) |
| `extensions/script-injector/locales/en.default.json` | Updated translations |

### Deleted Files
- `app/routes/app.scripts.new.jsx`
- `app/routes/app.scripts.$id.jsx`
- `app/components/ScriptForm.jsx`
- `app/components/ScriptList.jsx`
- `extensions/script-injector/blocks/head-script.liquid`
- `extensions/script-injector/blocks/body-start-script.liquid`
- `extensions/script-injector/blocks/body-end-script.liquid`

---

## Dependency Order

```
1.1 → 1.2 → 1.3 → 1.4 (Data layer)
       ↓
2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 (Dashboard wizard)
       ↓
3.1 → 3.2 → 3.3 (Theme extension)
       ↓
4.1 → 4.2 → 4.3 → 4.4 (Cleanup)
       ↓
5.x (Validation)
```

---

## Key Decisions (v3)

1. Scripts/CSS are hardcoded from the real `scriptlist.js` payloads — no placeholders,
   no GraphQL script-code storage.
2. Config metaobject is a **singleton**, fetched with no merchant-facing settings —
   matches the existing app-embed pattern, adds zero manual theme-editor steps beyond the
   one-time embed toggle.
3. One theme block total, repurposing the existing file rather than adding a parallel one.
4. Titles are cosmetic labels only; they never reach the storefront output.
5. Every wizard field auto-saves on change; the wizard is safe to abandon and resume at
   any step at any time.