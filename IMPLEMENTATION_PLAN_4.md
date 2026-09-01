# Implementation Plan 4 — Auto-Audit (One-Time) + Dashboard Results

## Overview

Upgrade the **Audit Script** (`script_1`, `data-script-id="script_1"`) from a hardcoded 2-URL
audit into a **one-time, auto-detect audit** of the store's important pages:

- **Home** (`/`)
- **PLP** (`/collections/<handle>`)
- **PDP** (`/products/<handle>`)

No other page types are added. The audit:

1. **Auto-detects** the Home, PLP and PDP URLs at runtime (no hardcoded list).
2. Runs **only once** — then stops injecting until the merchant toggles the app
   **main toggle OFF then ON** (Step 1).
3. Can be **fully removed** by toggling the audit script OFF in Step 2.
4. Sends its **two result arrays** (defer array `P` + hide-able selectors) back to the
   dashboard, shown in **two textareas in Step 3**.
5. Feeds the audited **defer array** into the **Defer Script** (`script_2`), so the defer
   script actually defers the scripts the audit found.

**Confirmed decisions (from Q&A):**
- Storefront → dashboard data via a **public app endpoint**.
- Audited `P` array **feeds into the Defer Script**.
- After audit completes, `script_1` **auto-stops injecting**; re-runs only on
  app-main-toggle OFF→ON.
- Important pages limited to **Home, PLP, PDP** (auto-detected).

---

## Current State (Baseline — Plan 3)

- Single config metaobject `$app:script_injector_config` with fields:
  `app_enabled`, `script_1/2/3_enabled`, `script_titles`, `debug_mode`.
- `script_1` (audit) payload hardcoded in BOTH `app/lib/scripts.ts` AND
  `extensions/script-injector/blocks/app-embed-head.liquid`. It navigates a **hardcoded
  `PAGES` array** (home + `collections/all`) and stores results to **localStorage only**
  (never reaches the dashboard).
- `script_2` (defer) has its own **hardcoded blocklist `P` array**; the liquid copy is
  **truncated/broken**.
- `script_3` (CSS) has an **empty** payload.
- `app._index.jsx`: wizard (Step1/Step2/Step3); `toggle-app` turns all 3 scripts ON;
  `toggle-script`; `save-titles`. Step 3 currently holds title textareas.
- `metaobjects.ts`: `getConfig`, `updateConfig`, `ensureConfig`, `deleteConfig`.
- Offline tokens stored in DB (`Session.isOnline=false`) → usable with
  `unauthenticated.admin(shop)`.

---

## Phase 0 — Data Model (Metaobject Fields)

**File:** `shopify.app.toml` — add to `[metaobjects.app.script_injector_config.fields.*]`:

```toml
[metaobjects.app.script_injector_config.fields.audit_defer_array]
name = "Audit Defer Array"
type = "list.single_line_text_field"

[metaobjects.app.script_injector_config.fields.audit_hide_selectors]
name = "Audit Hide Selectors"
type = "list.single_line_text_field"

[metaobjects.app.script_injector_config.fields.audit_complete]
name = "Audit Complete"
type = "boolean"

[metaobjects.app.script_injector_config.fields.app_endpoint]
name = "App Endpoint"
description = "Public /audit-submit URL of this app. Auto-populated from SHOPIFY_APP_URL on dashboard load; read by the storefront audit script (storefront public_read)."
type = "url"
```

**Purpose:**
- `audit_defer_array` → audited `P` (defer) array. Read by storefront (`public_read`),
  shown in Step 3, fed into Defer Script.
- `audit_hide_selectors` → audited off-screen CSS selectors. Read by storefront, shown
  in Step 3.
- `audit_complete` → when `true`, liquid stops injecting `script_1`.
- `app_endpoint` → the public `/audit-submit` URL, auto-synced from `SHOPIFY_APP_URL`
  on every dashboard load (via `ensureAppEndpoint`). Read by the storefront script so it
  can POST results back — replaces the earlier hardcoded `example.com` placeholder.

---

## Phase 1 — Backend: Types, Metaobjects, Public Endpoint

### Task 1.1 — Types (`app/types/script.ts`)
Extend `AppConfig` / `AppConfigInput`:
```ts
appEnabled, script1Enabled, script2Enabled, script3Enabled,
scriptTitles: string[],
debugMode,
auditDeferArray: string[],
auditHideSelectors: string[],
auditComplete: boolean,
```
Update field mapping in `metaobjects.ts` `buildFields`/`mapConfigFields`:
```
audit_defer_array    -> auditDeferArray
audit_hide_selectors -> auditHideSelectors
audit_complete       -> auditComplete
```

### Task 1.2 — Metaobjects (`app/lib/metaobjects.ts`)
- `setAuditResults(admin, { deferArray, hideSelectors })` — partial update via
  `updateConfig`: writes `auditDeferArray`, `auditHideSelectors`, and
  `auditComplete = true`.
- `resetAudit(admin)` — called when app main toggle turns OFF: sets
  `auditComplete = false` and clears both arrays (clean slate for a re-audit).

### Task 1.3 — Public endpoint for audit results
**New file:** `app/routes/audit-submit.jsx` (public, unauthenticated)

- `POST` handler (plain route, not authed).
- Derives the shop from the request `Origin`/`Referer` hostname (strip `www.` /
  `.myshopify.com`).
- Parses body `{ deferArray: string[], hideSelectors: string[] }`.
- Uses `unauthenticated.admin(shop)` → `setAuditResults(admin, ...)` to write into the
  config metaobject.
- Returns `200 { ok: true }` so the storefront script marks audit complete.
- **Security note (accepted risk):** public write endpoint for low-stakes config data.
  Mitigate by validating the shop has an existing offline token (else `404`). Derive
  shop from a trusted header.

The endpoint URL must be known to the storefront script → bake `SHOPIFY_APP_URL` into
the audit payload (Task 2.1).

---

## Phase 2 — Rewritten Audit Script (`script_1`)

### Task 2.1 — Single source of truth in `app/lib/scripts.ts`
Keep `script_1` payload in `app/lib/scripts.ts` (source of truth). Copy the rewritten
payload **verbatim** into `app-embed-head.liquid` (as today). The payload is a template
string with two Liquid-rendered substitution points:
- `__APP_ENDPOINT__` → `{{ config.app_endpoint.value | json }}` — the public
  `/audit-submit` URL, auto-synced from `SHOPIFY_APP_URL` into the config metaobject
  (`app_endpoint` field) on every dashboard load via `ensureAppEndpoint`. This avoids
  hand-editing the liquid (theme-extension blocks can't read `SHOPIFY_APP_URL`).
- `__AUDIT_COMPLETE__` → `{{ config.audit_complete.value | json }}`.

> **Fix applied:** the earlier hardcoded `https://example.com/audit-submit` placeholder
> was removed and replaced with the auto-synced `app_endpoint` config field (see Phase 0).

### Task 2.2 — Audit script behavior (rewrite)
Replace the hardcoded `PAGES` array + cross-page navigation with:

1. **Auto-detect page type** from `location.pathname`:
   - `/` → **home**
   - `/collections/<handle>` → **PLP**
   - `/products/<handle>` → **PDP**
2. **Once-only guard:** on load, read localStorage `shopAuditDone_v2`. If set → return.
   Also read the config metaobject's `audit_complete` (storefront `public_read`) → if
   already complete, return.
3. **Round-robin navigation:** maintain a page queue:
   - Start at **home**. On the home page, scrape links to a representative collection
     (`a[href*="/collections/"]`) and a representative product
     (`a[href*="/products/"]`) to discover PLP + PDP URLs.
   - Audit current page, then navigate to the next queued page (dedup by type: only ONE
     PLP, ONE PDP).
4. **Two outputs per page → aggregated** (reuse existing `auditP()` + `auditSelectors()`):
   - **Defer array (`P`)**: third-party/important script names + hosts.
   - **Hide selectors**: off-screen/structural CSS selectors (visible vs off-screen dedup).
5. **On completion of the LAST page:**
   - `POST` `{ deferArray, hideSelectors }` to `APP_ENDPOINT`.
   - On `200 ok`, set localStorage `shopAuditDone_v2 = "1"`.
   - Backend already set `audit_complete = true` → liquid stops injecting `script_1` →
     does **not** re-run on subsequent visits.
6. Re-run only when merchant toggles the app main toggle OFF (backend `resetAudit`
   clears `audit_complete`) then ON → localStorage key cleared on audit start.

### Task 2.3 — Defer Script (`script_2`) uses audited array
Rewrite `script_2` payload so its blocklist `P` array is **merged from the audited config**:
- In the liquid block, read `config.audit_defer_array.value` (storefront `public_read`).
- Build the defer `P` array from that audited list, **falling back to existing hardcoded
  defaults** when the audited list is empty.
- Keep the existing gating/release logic, now driven by `audit_defer_array`.

---

## Phase 3 — Update Theme Extension Liquid

### Task 3.1 — `extensions/script-injector/blocks/app-embed-head.liquid`
Apply config-driven logic:
```
audit_complete == true       → do NOT inject script_1
script_2 reads audit_defer_array (fallback hardcoded)
script_3 reads audit_hide_selectors (fallback empty)
```
Sketch:
```liquid
{% if config.audit_complete.value != true and config.script_1_enabled.value == true %}
  <!-- rewritten audit script: auto-detect home/PLP/PDP + one-time -->
{% endif %}
{% if config.script_2_enabled.value == true %}
  <script data-script-id="script_2">
    {%- assign deferList = config.audit_defer_array.value | default: DEFAULT_DEFER_LIST -%}
    <!-- defer script driven by deferList -->
  </script>
{% endif %}
{% if config.script_3_enabled.value == true %}
  <style data-script-id="script_3">
    {%- for sel in config.audit_hide_selectors.value -%}{{ sel }},{%- endfor -%}
  </style>
{% endif %}
```
> Recommend fixing the **truncated** `script_2` payload (single source from `scripts.ts`)
> while editing this file.

---

## Phase 4 — Dashboard (Step 2 & Step 3)

### Task 4.1 — `app/routes/app._index.jsx`
- New intents: `save-audit-defer`, `save-audit-hide` (manual edits to the two arrays).
- `toggle-app` OFF → call `resetAudit(admin)` (clear `audit_complete` + arrays) so
  re-enabling re-audits.
- Loader returns full `config` incl. new arrays.
- Keep `toggle-script`; toggling `script_1` OFF removes the audit script from `<head>`
  (honors "remove audit script on off toggle from step 2").

### Task 4.2 — `app/components/Step3Titles.jsx` → **Step 3: Audit Results**
- Show **two textareas**, one per line:
  - **Textarea 1 — "Defer Script Array"**: lines = `config.auditDeferArray`.
  - **Textarea 2 — "Hide CSS Classes"**: lines = `config.auditHideSelectors`.
- Auto-save on blur (`intent: save-audit-defer` / `save-audit-hide`), split on `\n`, trim.
- Keep script title labels as Step 2 toggle labels (cosmetic only).

### Task 4.3 — `app/components/Step2Configure.jsx`
Update labels to reflect audit/defer/hide roles; keep 3 toggles. When `script_1`
(audit) is off, it stops injecting immediately.

---

## Phase 5 — Cleanup & Integration

- Replace the **truncated** `script_2` payload in liquid with the full payload from
  `scripts.ts` (fix drift + keep single source).
- `script_3` empty payload: wire it to emit `audit_hide_selectors` as CSS
  (or note it remains a no-op until a CSS payload is provided).
- Sidebar/nav unchanged (`app.jsx`). Settings unchanged (no new UI needed).

---

## Phase 6 — Validation & Polish

1. `npm run typecheck`
2. `npm run lint`, `npx prettier --check .`
3. `shopify theme check` in extension folder
4. `shopify app config push` (deploy new metaobject fields)
5. `shopify app dev` manual pass:
   - Fresh install → app ON → audit auto-runs across **Home / PLP / PDP**
     (auto-detected URLs).
   - After the last page, results appear in **Step 3** textareas.
   - Audit does **not** re-run on refresh/new visits (once-only + `audit_complete`).
   - Toggling app OFF then ON → re-audits.
   - Toggling `script_1` OFF in Step 2 → audit script removed from `<head>`.
   - Defer Script defers the audited `P` array.

---

## Dependency Order

```
Phase 0 (fields) → 1.1 → 1.2 → 1.3 (backend)
      → 2.1 → 2.2 → 2.3 (scripts) → 3.1 (liquid)
      → 4.1 → 4.2 → 4.3 (dashboard)
      → Phase 5 cleanup → Phase 6 validation
```

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `app/routes/audit-submit.jsx` | Public endpoint: storefront audit results → metaobject |
| `IMPLEMENTATION_PLAN_4.md` | This plan |

### Modified Files
| File | Changes |
|------|---------|
| `shopify.app.toml` | New `audit_defer_array`, `audit_hide_selectors`, `audit_complete` fields |
| `app/types/script.ts` | New config fields |
| `app/lib/metaobjects.ts` | `setAuditResults`, `resetAudit`, field mapping |
| `app/lib/scripts.ts` | Rewritten audit payload; `script_2` uses audited array |
| `extensions/script-injector/blocks/app-embed-head.liquid` | config-driven script_1/2/3 logic; fix script_2 truncation |
| `app/routes/app._index.jsx` | new intents + resetAudit on app-off |
| `app/components/Step3Titles.jsx` | two audit-result textareas |
| `app/components/Step2Configure.jsx` | updated labels |
