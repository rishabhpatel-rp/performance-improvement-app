# Implementation Plan v3 - Performance Improvement App (Final)

## Overview
Replaces the flexible script-management system with a **3-step wizard dashboard** matching `Desing_plan.md` and **3 pre-defined, hardcoded scripts** (2 scripts + 1 CSS) that inject only into `<head>`.

**Assumptions confirmed:**
- Each toggle/textarea change saves immediately via `useFetcher` (auto-save per field)
- Dashboard styling follows `Desing_plan.md` card/color/stepper styling (custom CSS layered on top of the Polaris web-component shell `<s-page>` etc.)
- Step 3 has no design spec — follows same card pattern with titles textarea
- Footer uses generic performance branding (not "BOOSTER APPS")
- Step 2 shows **3 independent script toggles** (per confirmed flow); this overrides the design plan's "Preview" screen

---

## Architecture Changes

### Old (Removed)
- User-created scripts with full CRUD
- Position selection (head/body_start/body_end)
- Target pages, async, defer, priority
- Drag-and-drop reordering
- `ScriptForm` component with complex fields

### New (Simplified)
- **3 pre-defined payloads** (hardcoded from `scriptlist.js` + your CSS):
  1. **Script 1 ("Audit script")** — `<script>` payload, enabled by Step 2 toggle 1
  2. **Script 2 ("Work script")** — `<script>` payload (dummy for now), enabled by Step 2 toggle 2
  3. **Script 3 ("Work css")** — `<style>` payload (your CSS), enabled by Step 2 toggle 3
- **App activation toggle** (Step 1: "Enable Performance Improvement App") — gates all 3 scripts; Step 2 toggles are disabled until this is on
- **3 independent script toggles** (Step 2: one per predefined script, enabled by `app_enabled`)
- **Textarea for script titles** (Step 3: array of 3 strings, cosmetic labels only)
- All payloads inject to **`<head>` only**
- Theme extension has exactly **one** app-embed block (`app-embed-head.liquid`), no merchant-facing settings

---

## Phase 1: Data Layer & Metaobjects (Backend)

### Task 1.1: Update Metaobject Definitions
**File:** `shopify.app.toml`

- Remove `[metaobjects.app.script_injector_script]` entirely
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

**Notes:**
- Keeps `script_1_enabled`, `script_2_enabled`, `script_3_enabled` (3 **independent** script toggles)
- `app_enabled` is the master gate — a script only renders when `app_enabled` **and** its own toggle are both true
- `auto_inject` removed — redundant with `app_enabled`
- `script_titles` is `list.single_line_text_field` (array in Liquid, not string)

**Data migration note:** If deployed to live shop with existing `script_injector_script` metaobjects, removing the definition from `shopify.app.toml` does not delete remote data. Confirm before deploy or explicitly delete via Admin API/CLI first.

### Task 1.2: Pre-defined Scripts (Real Code)
**File:** `app/lib/scripts.ts` (new)

```typescript
export const PREDEFINED_SCRIPTS = [
  {
    id: 'script_1',
    name: 'Audit Script',
    type: 'script',
    code: `/* VERBATIM PAYLOAD FROM scriptlist.js ITEM 1 — copy exactly */`,
    defaultEnabled: false,
  },
  {
    id: 'script_2',
    name: 'Work Script',
    type: 'script',
    code: `/* VERBATIM PAYLOAD FROM scriptlist.js ITEM 2 — copy exactly */`,
    defaultEnabled: false,
  },
  {
    id: 'script_3',
    name: 'Work CSS',
    type: 'style',
    code: `/* YOUR CSS PAYLOAD HERE — replace empty <style></style> */`,
    defaultEnabled: false,
  },
] as const;

export type PredefinedScript = typeof PREDEFINED_SCRIPTS[number];
export type ScriptType = 'script' | 'style';
```

**Critical:** Copy exact minified bodies from `scriptlist.js` — do not paraphrase.

### Task 1.3: Simplified GraphQL Operations
**File:** `app/lib/metaobjects.ts` (replace)

Remove: `getScripts`, `getScript`, `createScript`, `updateScript`, `deleteScript`, `reorderScripts`, `deleteAllScriptsForShop`.

Keep/rewrite:
- `getConfig(request)` — fetch singleton config metaobject (calls `ensureConfig` internally)
- `updateConfig(request, input)` — partial update (single field or all); `script_titles` written as GraphQL list input
- `ensureConfig(request)` — onboarding: creates config with all fields `false`/empty if none exists

**Field mapping (snake_case ↔ camelCase):**
```
app_enabled       -> appEnabled
script_1_enabled  -> script1Enabled
script_2_enabled  -> script2Enabled
script_3_enabled  -> script3Enabled
script_titles     -> scriptTitles   // array, not joined string
debug_mode        -> debugMode
```

### Task 1.4: Simplified TypeScript Types
**File:** `app/types/script.ts` (replace)

```typescript
export interface AppConfig {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  scriptTitles: string[]; // exactly 3 entries: [title1, title2, title3]
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
  type: 'script' | 'style';
  code: string;
  defaultEnabled: boolean;
}
```

---

## Phase 2: Dashboard UI - 3-Step Wizard (Frontend)

### Design Reference
All visual specs from `Desing_plan.md`:
- Background: `#F8F9FA`, Container: `max-width: 800px`, Font: Inter/System UI
- Stepper: 3 circles (36px), Active `#00B856`, Inactive `#E2E7EC`, Line `#E0E0E0`
- Labels: "Start" / "Scripts" / "Titles" (13px, bold, `#333333`)
- Card: White, border `#E5E8EC`, radius 4px
- Green banner (Step 1): `#E8F8F0` bg, `#00C853` top border
- (Step 2 uses the card pattern + 3 toggle switches; no yellow banner — the design plan's Preview screen is not used)
- Toggle: Pill 60x30px, `#00C853` active, white "ON" text
- Footer: Generic performance branding (rocket icon, "Performance App", tagline)

### Task 2.1: Dashboard Route - Wizard Container
**File:** `app/routes/app._index.jsx` (replace)

**State:** `currentStep` (1, 2, 3) — local UI only

**Loader:** `getConfig` (auto-ensures config exists)

**Structure:**
```jsx
<s-page heading="Performance Improvement">
  <WizardProgress steps={['Start', 'Scripts', 'Titles']} currentStep={currentStep} />
  
  {currentStep === 1 && <Step1Activate config={config} />}
  {currentStep === 2 && <Step2Scripts config={config} />}
  {currentStep === 3 && <Step3Titles config={config} />}
  
  <WizardNavigation currentStep={currentStep} onChange={setCurrentStep} />
  <FooterBranding />
</s-page>
```

### Task 2.2: Step 1 - Activate App (Start)
**Component:** `app/components/Step1Activate.jsx` (new)

Per `Desing_plan.md` Screen 1:
- Header: "Let's increase your page speed 😊" (24px, bold, centered)
- Green info banner: "How is this app FREE..." + "Since 2015..." copy
- Rocket illustration (centered, minimal vector style)
- Instruction: "Improve the Speed of your Store and increase Conversions by switching this ON 👇"
- **Toggle**: "Enable Performance Improvement App" → saves `appEnabled` immediately
- "Continue ➔" button (22px, bold, text-link style)

**Auto-save:** Toggle change → `fetcher.submit({ intent: 'toggle-app', appEnabled: newValue })`

### Task 2.3: Step 2 - Choose which scripts run (Scripts)
**Component:** `app/components/Step2Scripts.jsx` (new)

- Header: "Choose which scripts run" (24px, bold, centered)
- Short paragraph describing what the app does
- **3 toggles**, one per predefined script (`PREDEFINED_SCRIPTS`), each labeled with the current title from `config.scriptTitles[i]` (falling back to the script's default `name`):
  - Toggle 1 → `script1Enabled` ("Audit Script")
  - Toggle 2 → `script2Enabled` ("Work Script")
  - Toggle 3 → `script3Enabled` ("Work CSS")
- Each toggle saves immediately on change (auto-save): `fetcher.submit({ intent: 'toggle-script', scriptIndex, enabled })`
- All toggles **disabled** if `appEnabled` is false, with a note: "Enable the app in Step 1 first"
- "← Back" / "Continue ➔" buttons (navigation only)

**Toggle → field mapping:**
| Toggle | Config field |
|--------|--------------|
| Toggle 1 | `script1Enabled` |
| Toggle 2 | `script2Enabled` |
| Toggle 3 | `script3Enabled` |

### Task 2.4: Step 3 - Name the scripts (Titles)
**Component:** `app/components/Step3Titles.jsx` (new)

- Header: "Name the scripts" or "Script Titles" (24px, bold, centered)
- Help text: "These are labels only — used to relabel the toggles in Step 2 for your own reference. They never alter the injected code. Leave blank to use generic defaults."
- Textarea:
  - Placeholder: "Enter a title for each script, one per line, in order."
  - Pre-filled: `config.scriptTitles.join('\n')` (up to 3 lines)
  - On blur/submit: save immediately via `fetcher.submit({ intent: 'save-titles', titles })`
  - Split on `\n`, trim, pad/cap to 3 entries before saving
- "← Back" / "Done" button (Done just confirms/exits; each field auto-saves)

### Task 2.5: Wizard Navigation
**Component:** `app/components/WizardNavigation.jsx` (new)

- Step 1: "Continue ➔" (advances to 2)
- Step 2: "← Back" / "Continue ➔"
- Step 3: "← Back" / "Done"
- Pure UI navigation — no save logic (each field auto-saves)

### Task 2.6: Wizard Progress Indicator
**Component:** `app/components/WizardProgress.jsx` (new)

- 3 circles connected by 2px line `#E0E0E0`
- Active/completed: `#00B856` filled, white number
- Inactive: `#E2E7EC` filled, white number
- Labels under circles: "Start" / "Scripts" / "Titles"
- Clickable to jump between steps

### Task 2.7: Footer Branding
**Component:** `app/components/FooterBranding.jsx` (new)

- Rocket icon (circular, dark grey, white rocket)
- "PERFORMANCE APP" (bold, 20px, dark grey)
- "OPTIMIZE YOUR SHOPIFY STORE" (11px, light grey, caps)
- "Proudly serving thousands of Shopify merchants" (12px, `#718096`)
- "Terms of use" link (12px, blue `#2B6CB0`, underlined)

---

## Phase 3: Theme App Extension (Storefront)

### Task 3.1: Extension Config — No Changes
**File:** `extensions/script-injector/shopify.extension.toml`

**Stays as-is** (name/type/version/uid only). Blocks auto-discovered from `/blocks` via `{% schema %}`.

### Task 3.2: Repurpose Existing Head Block
**File:** `extensions/script-injector/blocks/app-embed-head.liquid` (replace in place)

```liquid
{% comment %}
  App Embed block (target: head). No settings — merchant enables this ONCE in
  Theme Editor > App embeds. Reads the shop's single config metaobject and injects
  whichever predefined scripts are toggled on, straight into <head>.
{% endcomment %}

{% assign config = shop.metaobjects.script_injector_config.values | first %}

{% if config and config.app_enabled.value == true %}
  {% comment %} Script 1: Audit (toggled independently) {% endcomment %}
  {% if config.script_1_enabled.value == true %}
    <script data-script-id="script_1"
      {% if content_for_header contains 'nonce-' %}
        nonce="{{ content_for_header | split: 'nonce-' | last | split: '"' | first }}"
      {% endif %}>
      {{ PREDEFINED_SCRIPT_1_PAYLOAD }}
    </script>
  {% endif %}

  {% comment %} Script 2: Work script (toggled independently) {% endcomment %}
  {% if config.script_2_enabled.value == true %}
    <script data-script-id="script_2"
      {% if content_for_header contains 'nonce-' %}
        nonce="{{ content_for_header | split: 'nonce-' | last | split: '"' | first }}"
      {% endif %}>
      {{ PREDEFINED_SCRIPT_2_PAYLOAD }}
    </script>
  {% endif %}

  {% comment %} Script 3: Work CSS (toggled independently) {% endcomment %}
  {% if config.script_3_enabled.value == true %}
    <style data-script-id="script_3">
      {{ PREDEFINED_SCRIPT_3_PAYLOAD }}
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

**Notes:**
- `PREDEFINED_SCRIPT_X_PAYLOAD` = verbatim strings from `app/lib/scripts.ts` (copy into Liquid)
- `script_titles` array available as `config.script_titles.value` — **do not split** (already array)
- Titles are **not rendered** in storefront (dashboard-only labels)
- No settings in schema — zero merchant configuration beyond app-embed toggle

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

**Keep:** `app-embed-head.liquid` (repurposed in Task 3.2)

### Task 4.2: Update Navigation
**File:** `app/routes/app.jsx`

Sidebar: Dashboard (wizard) + Settings only.

### Task 4.3: Update Settings Page
**File:** `app/routes/app.settings.jsx` (simplify)

Keep: Debug mode toggle, theme editor deep link, danger-zone reset.
Remove: Auto-inject toggle (superseded by Step 1 `app_enabled`).

### Task 4.4: Webhook Handler
**File:** `app/routes/webhooks.app.uninstalled.jsx`

Keep existing cleanup (delete config metaobject on uninstall).

---

## Phase 5: Validation & Polish

1. `npm run typecheck`
2. `npm run lint`, `npx prettier --check .`
3. `shopify theme check` in extension folder — confirm no stale `script_injector_script` references
4. `shopify app dev` manual pass:
   - Wizard flows 1→2→3, each toggle persists on change (reload mid-wizard, state survives)
   - Theme Editor shows exactly **one** app-embed toggle for this app
   - With app enabled + Script 1 toggle: Script 1 (`<script>`) renders in `<head>`
   - With app enabled + Script 2 toggle: Script 2 (`<script>`) renders in `<head>`
   - With app enabled + Script 3 toggle: Script 3 (`<style>`) renders in `<head>`
   - Toggles are **independent** — enabling one does not enable the others
   - Titles from Step 3 show as toggle labels in Step 2 on reload, never in storefront output
   - Visual match to `Desing_plan.md` (colors, spacing, banners, stepper, footer)

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `app/lib/scripts.ts` | Real predefined script/style payloads |
| `app/components/Step1Activate.jsx` | Step 1: app toggle + green banner + rocket |
| `app/components/Step2Scripts.jsx` | Step 2: 3 independent script toggles |
| `app/components/Step3Titles.jsx` | Step 3: titles textarea |
| `app/components/WizardProgress.jsx` | Step indicator (Start/Scripts/Titles) |
| `app/components/WizardNavigation.jsx` | Prev/Next/Done buttons |
| `app/components/FooterBranding.jsx` | Generic performance footer |

### Modified Files
| File | Changes |
|------|---------|
| `shopify.app.toml` | New config fields, old script type removed |
| `app/lib/metaobjects.ts` | Config-only ops, explicit field mapping |
| `app/types/script.ts` | New simplified types |
| `app/routes/app._index.jsx` | Wizard container |
| `app/routes/app.settings.jsx` | Minimal settings |
| `app/routes/app.jsx` | Simplified navigation |
| `extensions/script-injector/blocks/app-embed-head.liquid` | Repurposed for new config-driven logic |
| `extensions/script-injector/locales/en.default.json` | Updated translations |

### Deleted Files (7)
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
2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 (Dashboard wizard)
       ↓
3.1 → 3.2 → 3.3 (Theme extension)
       ↓
4.1 → 4.2 → 4.3 → 4.4 (Cleanup)
       ↓
5.x (Validation)
```

---

## Key Decisions (Final)

1. **Payloads hardcoded** from real `scriptlist.js` + your CSS — no placeholders, no GraphQL script storage
2. **Config metaobject is singleton**, fetched with no merchant-facing settings — matches existing app-embed pattern
3. **One theme block total**, repurposing existing `app-embed-head.liquid`
4. **Script enablement**: `app_enabled` is the master gate; each of the 3 scripts has an **independent** toggle (`script_1_enabled`, `script_2_enabled`, `script_3_enabled`) — a script renders only when both are true
5. **Titles are cosmetic labels only**; never reach storefront output
6. **Every wizard field auto-saves on change**; wizard safe to abandon/resume at any step
7. **Step 1 & Step 3 match `Desing_plan.md` card styling**; Step 2 ("Scripts") is a 3-toggle screen per the confirmed flow (overrides the design plan's Preview screen)
8. **Footer uses generic performance branding** (not BOOSTER APPS)