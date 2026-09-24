# PagePulse Performance: requirements and plans (2026-09-24)

Everything requested in the working session of 2026-09-24, and every plan made for it, merged into one document.

- **Plans 1–3** were made in the Claude Code session that produced this file. Plans 1 and 2 were reconstructed from the conversation, because the plan file was overwritten between tasks.
- **Plan 4** came from another session in the same workspace (`~/.claude/plans/give-me-points-what-joyful-nebula.md`).
- If this file and the code disagree, the code wins (same rule as `PROJECT_FLOW.md`).

---

## 1. Requirements (in the order they were given)

| # | Requirement | Status |
|---|---|---|
| R1 | Check the whole two-app flow (Shopify app + admin panel) and understand it properly. | Done. Summary and issue list in section 2. |
| R2 | The main Step 1 toggle must check on every page refresh whether the app extension is installed. If it isn't, the toggle switches OFF automatically. If anything errors during that check, it also switches OFF. | Implemented (Plan 1). |
| R3 | When the merchant is slow to install the extension, the toggle showed ON together with an error. On error it should turn OFF automatically. | Implemented (Plan 2). |
| R4a | Give the merchant a way to choose which theme the extension is installed in, before installing it. | Implemented as a dropdown (Plan 3). |
| R4b | The audit starts "directly with 60s". Check why. | Cause found and fixed (Plan 3). |
| R4c | The audit loader text should show which page is currently being audited. | Implemented in Plan 3, then the loader was reworked by another session (see section 7). |

Decisions given for R4: theme picker as a **dropdown**; the audit scans the **selected theme**; the countdown was starting at **60s**.

---

## 2. R1: the two-app flow (findings)

**Apps.** Two separate Node processes sharing one Postgres:
- Shopify embedded app in `/app` and `/extensions` (React Router 7, Polaris web components, Prisma). Merchants use it.
- Admin panel in `/admin-panel` (Next.js 15, iron-session). Read-only fleet dashboard for the Brainvire team.

**Shopify app flow.**
1. **Load.** `app.jsx` authenticates, then `app._index.jsx` loads the dashboard from the DB (fast path). It refreshes from Shopify when the store is new, was last synced over 10 minutes ago, or the app URL changed.
2. **Wizard.** Step 1 has one master toggle. Turning it ON validates through `/api/toggle-validate`: the extension must be enabled and, for password-protected stores, a storefront password must be saved. Then `toggle-app` runs `resetAudit` and starts the hidden audit. Step 2 unlocks when the audit completes.
3. **Hidden audit.** `audit.server.ts` discovers Home, a collection page and a product page, and runs the audit script in headless Chromium. The result is the defer list and the hide-selector list, saved to `StoreConfig`.
4. **Storefront delivery.** The theme app embed `performance-loader.liquid` calls `/apps/performance-scripts`, an app-proxy route that serves the compiled defer script and hide CSS.
5. **Sources of truth.** Flags live in the metaobject `$app:script_injector_config`, mirrored to Postgres. The audit arrays, per-field toggles, password and custom URLs are DB-only.
6. **Lifecycle.** The uninstall webhook soft-deletes the store. The `shop/redact` compliance webhook erases the data.

**Admin panel flow.** `/setup` creates the first admin once. `/login` sets an iron-session cookie. Middleware only checks that the cookie is present, and the dashboard layout does the real check. Pages read `Store`, `StoreConfig` and `StoreActivity`. A cookie-based demo mode merges dummy stores in memory.

**Issues found in R1** (not all fixed):
1. The admin-panel Prisma schema has drifted (no audit columns), so "audits completed" is always 0 on real data and the config viewer can't show audit state.
2. `totalOrders` and `locale` are never populated because the shop query never requests them.
3. `script1/2/3Enabled` do not affect the storefront, and `PREDEFINED_SCRIPTS` is empty.
4. Dead code: `api.script.jsx`, `api.save-performance-scripts.jsx`, `api.step-3.jsx`, and the `/audit-submit` endpoint that doesn't exist.
5. `api.audit.start` did not record progress or completion. **Fixed in Plan 3** by the shared audit runner.
6. `prisma/seed.ts` creates `admin@performance-app.com` / `admin123` by default.
7. `/api/demo` has no auth check (it only sets a UI cookie).
8. `shopify.web.toml` has an uncommitted change that unsets `PLAYWRIGHT_BROWSERS_PATH`. The two TOML files are two different Partner apps.

After the summary you chose "Deep-dive one area" but did not name one.

---

## 3. Plan 1: re-check the extension on every load, fail closed (R2)

### Cause (all in `app/routes/app._index.jsx`)
| # | Problem |
|---|---|
| 1 | On the fast path (active store, synced under 10 minutes ago) the embed was never checked. The code set `embedCheck = null`, which was read as "enabled". |
| 2 | `embedEnabled = embedCheck !== false` failed open. A timeout, error or `null` counted as enabled. |
| 3 | On the slow path, an error in the embed check also returned `null`, which flowed into #2. |
| 4 | Even when the UI forced OFF, `appEnabled` stayed `true` in the metaobject and DB, so the admin panel showed "enabled" and the problem repeated on the next fast-path load. |

The client already forced the toggle OFF when `embedEnabled` was false, so the fix lives in the loader.

### Changes
1. **Always run the embed check, in parallel.** `embedPromise = withShopifyTimeout(isAppEmbedEnabled(...))`, with a 3s cap. Errors are caught and turned into `null`, except an auth redirect, which is re-thrown. The fast path awaits this promise. The slow path uses it in the existing `Promise.all`, so there is still one embed call per load. A no-op `.catch` prevents an unhandled rejection if the loader exits early.
2. **Fail closed.** `embedEnabled = embedCheck === true`. `embedStatus` is `"enabled"`, `"disabled"` or `"unknown"`.
3. **Persist OFF only for a definite `false`.** If the embed is definitely off and the app is recorded as enabled, set `appEnabled=false` in Postgres and in the metaobject, log a `config_changed` activity, and return the config with `appEnabled` false. An error or timeout (`null`) never writes. Audit results are kept, and turning the app back ON goes through `toggle-app`, which starts a fresh audit. This logic is now the helper `disableAppBecauseEmbedOff`.
4. **Return `embedStatus`** from the loader and pass it to `Step1Activate`.
5. **Explanation for the merchant.** A warning banner with an install button when the embed is off or unverifiable. Plan 3 later moved this status into the theme picker card.
6. **Not done (optional):** re-check when the tab regains focus while the app is ON. It costs one extra Admin call per focus.

### Trade-off
One extra Admin GraphQL call (`MainThemeSettings`) on every page load, about +150–300ms on the fast path.

### Files
`app/routes/app._index.jsx`, `app/components/Step1Activate.jsx`.

---

## 4. Plan 2: the switch snaps back OFF when enabling fails (R3)

### Cause
`<s-switch>` flips itself visually the moment it is clicked. When the pre-check (`/api/toggle-validate`) or the `toggle-app` action refused, only the banner appeared. Our `checked` prop stayed `false`, so React never re-rendered the switch and it kept showing ON next to the error.

### Fix (in `app/components/Step1Activate.jsx`)
- A `switchKey` state is used as the `key` on `<s-switch>`.
- It is bumped (remounting the switch from `checked={false}`) when validation returns `allowed: false`, or when the `toggle-app` action returns `ok: false`.
- The banner and the theme-editor redirect work as before.

### Left open
If the hidden audit fails after the app is enabled, the toggle stays ON with an "Audit failed" message. Turning it OFF would also clear the error and reset the audit state, so this was not changed without your decision.

---

## 5. Plan 3: theme picker and honest audit loader (R4a, R4b, R4c)

### 5.1 Findings
**The "60s".** `Step1Activate` computed `remaining = (pages - pageIndex - 1) * 30 + (30 - elapsedOnPage)`.
1. Before the server reported a total, the UI assumed 3 pages (90s).
2. `discoverPages()` always returns Home, but the collection and product pages only if found (Admin GraphQL, then a homepage scrape). A store with no collection or no product audits **2 pages**, giving `(2-0-1)*30 + 30 = 60s`.
3. The total was only written after Chromium launched and page 1 loaded.
4. The merchant was never told which pages were audited, or why only two.
5. The per-page clock started on component mount, so a refresh reset it.
6. `onProgress` fired every second and wrote to the DB each time.

**Other defects found on the way.**
- `getActiveThemeId()` queried `themes(first:1, sortKey: UPDATED_AT)`. `themes` has no `sortKey` argument, so it always failed silently. Replaced.
- `api.audit.start.jsx` duplicated `startHiddenAudit`. Both now use one shared runner.

**Theme APIs** (validated with the Shopify dev MCP against Admin 2026-07; scope `read_themes` already granted):
```graphql
query StoreThemes { themes(first: 50) { nodes { id name role updatedAt } } }
query ThemeEmbed($id: ID!) {
  theme(id: $id) {
    id role
    files(filenames: ["config/settings_data.json"]) {
      nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
    }
  }
}
```
Roles shown: MAIN (Live), UNPUBLISHED, DEMO. Hidden: DEVELOPMENT, ARCHIVED, LOCKED. Deep link:
`https://admin.shopify.com/store/<store>/themes/<numericThemeId>/editor?context=apps&activateAppId=<api_key>/performance-loader`.

### 5.2 Data model
New nullable columns on `StoreConfig`, in migration `20260924120000_add_selected_theme_and_audit_pages`:
- `selectedThemeId String?`: theme GID; `null` means the live theme.
- `auditPages Json?`: `[{ label, path }]` for the current or last audit, paths only.
- `auditPageStartedAt DateTime?`: when the current page started (timer that survives a refresh).

### 5.3 Server
- `app/lib/theme-embed.server.js`:
  - `listThemes(admin)`.
  - `isAppEmbedEnabled(admin, handle, themeId?)` (no id means the live theme; a deleted theme means `false`; an error means `null`).
  - `getAppEmbedDeepLink(shop, apiKey, handle, themeId?)`.
  - `getSelectedThemeId(shopDomain)`, and `numericThemeId`.
- Every embed check and deep link now uses the selected theme: the dashboard loader, `toggle-app`, `api.toggle-validate`, `api.audit.start`, and `app.extension` (which also shows the theme name).
- `app/routes/api.themes.jsx` (new): GET, returns `{ themes, selectedThemeId, liveThemeId }` with a 3s timeout. The picker fetches it on mount, so the dashboard loader gets no extra Admin call.
- `app/routes/app._index.jsx`:
  - New `select-theme` action: validates the id against `listThemes`, saves `selectedThemeId`, logs activity, and if the app is ON and the new theme lacks the embed, turns the app OFF (the same helper as Plan 1).
  - The loader returns `selectedThemeId`.
- `app/lib/audit.server.ts`:
  - `getActiveThemeId` removed.
  - `appendPasswordBypass` became `appendPreviewParams`, so the theme id applies with or without a password.
  - `describePages()` returns labels and URL paths only (no password or theme parameter reaches the DB or UI).
  - `onProgress` fires only when the page changes.
- `app/lib/audit-runner.server.ts` (new): `startAuditForStore()`, used by both the toggle and `api.audit.start`.
  1. Reset the run.
  2. Resolve the preview theme id. It is added only for a non-live selected theme.
  3. Discover pages, then save `auditPages` and `auditTotalPages` before Chromium launches.
  4. Run the audit and record progress.
  5. Save the report, or record the failure and an `AuditLog` row.
- `app/routes/api.audit.status.jsx`: adds `pages`, `pageStartedAt`, `serverNow`.
- `app/lib/store-sync.server.ts`: `readAuditPages()` helper.

### 5.4 Step 1 UI (`app/components/Step1Activate.jsx`)
```
 1  Choose the theme for the app extension
    Theme  [ Dawn (Live)                  v ]     [ Install extension in this theme ]
    Extension is enabled / not enabled in "Dawn"
 2  Enable Performance Improvement App    [ toggle ]
```
- A dropdown (`<s-select>` with `<s-option>`), with the live theme pre-selected. It snaps back to the real value if a save is refused.
- Status line driven by `embedStatus`. The install button opens the theme editor deep link for the chosen theme.
- Fail-closed states:

  | State | UI | Toggle |
  |---|---|---|
  | Loading themes | spinner | not blocked |
  | `/api/themes` failed | message + Retry | blocked |
  | Selected theme deleted | "Select a theme" | blocked until chosen |
  | Only the live theme exists | single-option dropdown | normal |
- **Original loader design (later reworked, see section 7).** Show "Preparing audit…" until the page count is known. Then show "Auditing Collection page (2 of 3)" with the path, page markers, and a countdown from the real page count. Add a hint when fewer than 3 pages are found.

### 5.5 Files
- Modified: `prisma/schema.prisma`, `app/lib/theme-embed.server.js`, `app/lib/audit.server.ts`, `app/lib/store-sync.server.ts`, `app/routes/app._index.jsx`, `app/routes/api.audit.start.jsx`, `app/routes/api.audit.status.jsx`, `app/routes/api.toggle-validate.jsx`, `app/routes/app.extension.jsx`, `app/components/Step1Activate.jsx`.
- New: `app/lib/audit-runner.server.ts`, `app/routes/api.themes.jsx`, migration `20260924120000_add_selected_theme_and_audit_pages`.

### 5.6 Risks
- The theme-specific deep link is the documented `themes/current` form with the id substituted. It needs confirming on the dev store.
- `?preview_theme_id=` on an unpublished theme adds Shopify's preview bar. The audit script ignores it, but compare the results once.
- The theme list is capped at 50.
- Existing installs have `selectedThemeId = null`, so behaviour is unchanged until a theme is picked. The columns are nullable and additive, so rollback is safe.

---

## 6. Plan 4: pre-build the storefront script (from another session)

Source: `~/.claude/plans/give-me-points-what-joyful-nebula.md`. Not part of the requests above.

**Goal.** Today `api.storefront-scripts.jsx` obfuscates the script (about 0.7s of CPU, about 200 KB) on every storefront request, and the theme block loads it late (fetch, then `new Function`), so it can miss scripts the browser has already parsed. Instead, obfuscate once when inputs change, store the finished JS in the DB, and serve it as a synchronous first-in-`<head>` script.

1. **Rename** the generator arguments in `script-generator.js` to a single options object:

   | Old | New |
   |---|---|
   | `auditArray` | `interactionGatedScripts` |
   | `firstUserDelayScripts` / `firstUserDelayMs` | `firstVisitDelayedScripts` / `firstVisitDelayMs` |
   | `deferArray` | `everyLoadDelayedScripts` |
   | `everyTimeDelayMs` | `everyLoadDelayMs` |

   Behaviour is unchanged. DB column names are unchanged.
2. **New builder** `rebuildPerformanceScript(shopDomain)` in `performance-script.server.ts`: load store and config. If the store is inactive or the app is disabled, write an empty script. Otherwise apply the per-field enabled flags, generate the script, hash it (sha256) and upsert `PerformanceScript`.
3. **Storage.** Use `deferScript` for the final JS. Add `scriptHash` and `scriptBuiltAt` (migration `20260924130000_add_performance_script_hash`). Stop writing `auditScript` (the JSON report).
4. **Rebuild triggers** (inside the store-sync functions so every caller is covered): `saveAuditReport`, `updateAuditArrays`, `updateAuditFieldToggle`, `toggle-app` (including the OFF branch), and `markStoreUninstalled` (writes an empty script).
5. **Serve the stored script.** Keep the app-proxy signature check and read one DB row. Respond as JavaScript with `ETag`, `Cache-Control: public, max-age=300, stale-while-revalidate=86400`, and 304 on `If-None-Match`. Lazily backfill existing installs that have no built script. Tradeoff: changes reach cached visitors within about 5 minutes.
6. **Loader.** Replace the fetch-and-eval snippet in `performance-loader.liquid` with `<script src="/apps/performance-scripts"></script>` (target `head`). The generator injects the hide `<style>` itself. Needs `shopify app deploy`. Risk: a synchronous proxy request blocks HTML parsing until it returns or is cached, hence the DB read, ETag and cache headers.

**Verification (from that plan).** Confirm the new columns after `prisma migrate dev`. Check the rebuild after enabling, editing, toggling and disabling. `curl` for 200 and `ETag`, then 304. Check the script tag sits early in `<head>`. Check the lazy backfill and lint.

---

## 7. Current repository state

**Changes from this session (Plans 1–3):** implemented. They passed `eslint` and the production build. They have **not** been run against a real Shopify session. Migration `…120000` has not been applied by this session. `shopify app dev` runs `prisma migrate deploy`.

**Changes from another session, present in the working tree:**
- Plan 4 files: `performance-script.server.ts`, migration `…130000_add_performance_script_hash`, and edits to `script-generator.js`, `api.storefront-scripts.jsx`, `performance-loader.liquid`, `store-sync.server.ts`.
- Parallel audit: the audit now visits the pages in parallel (`audit-script.ts`, `audit.server.ts`), and `onProgress` reports `done` pages. A new `auditPhase` column (migration `…140000_add_audit_phase`) drives a phase-based Step 1 loader (discovering, auditing, building) with no guessed countdown.
- These edits also touched files Plan 3 had changed: `audit-runner.server.ts`, `store-sync.server.ts`, `Step1Activate.jsx`.

**Consequences to be aware of:**
- Plan 3's sequential loader design (a countdown and "current page (2 of 3)") is superseded by the phase-based loader. With parallel pages there is no single current page. Whether the loader still names the pages being audited was not verified.
- `PROJECT_FLOW.md` and the R1 storefront-delivery description above (JSON `{auditScript, hiddenCss}` plus fetch-and-eval) are now out of date, because delivery is now a stored script served as JavaScript.
- The changes from the other session were not reviewed in this session.

---

## 8. Open decisions

1. Should a failed audit switch the toggle OFF? (Plan 2 left this open.)
2. Should the app re-check the extension when the tab regains focus while ON? (Plan 1, item 6.)
3. Should the loader name the pages being audited under the parallel audit, for example all three pages with per-page done and pending state?
4. Confirm on the dev store that the theme-specific editor deep link opens the right theme with the extension pre-selected.
5. Do the R1 issues (admin-panel schema drift, `totalOrders`/`locale`, seed credentials, dead routes) need fixing?

---

## 9. Manual test checklist

| Area | Case | Expected |
|---|---|---|
| Plan 1 | Embed ON and app ON, refresh | Toggle stays ON. |
| Plan 1 | Disable the embed in the theme editor, refresh | Toggle OFF, Step 2 locked, DB and metaobject `appEnabled=false`, activity row. |
| Plan 1 | Check errors or times out | Toggle OFF, DB unchanged. |
| Plan 1 | Fast path (two refreshes within 10 minutes, embed off) | Toggle OFF both times, check runs each time. |
| Plan 2 | Click ON with the embed missing | Switch flicks ON while checking, then returns OFF with the banner. |
| Plan 2 | Enable the embed, come back, toggle ON | Stays ON, audit starts. |
| Plan 3 | Open Step 1 | Dropdown lists live and unpublished themes, live pre-selected, correct status. |
| Plan 3 | Pick an unpublished theme, click Install | Editor opens on that theme with the embed pre-selected. |
| Plan 3 | Change theme while ON, new theme lacks the embed | Toggle auto-OFF, activity logged. |
| Plan 3 | Selected theme deleted | Placeholder shown, toggle blocked. |
| Plan 3 | `/api/themes` fails | "Couldn't load themes" and Retry, toggle blocked. |
| Plan 3 | Store with only 2 pages | Page list shows exactly those pages, hint shown. |
| Plan 3 | Audit on an unpublished selected theme | Server log shows `preview_theme_id`; UI and DB show paths only. |
| Plan 3 | Audit on the live theme | No `preview_theme_id` in URLs. |
| Plan 4 | Enable app, audit completes | `performance_scripts.defer_script`, `script_hash`, `script_built_at` populated. |
| Plan 4 | `curl /apps/performance-scripts` | 200 with JS and `ETag`; repeat gives 304. |
| Plan 4 | Existing store with no built script | First request backfills and serves correctly. |
| All | `npx prisma validate`, `npx eslint app` | Clean on the changed files. Three pre-existing lint errors remain in `Step3Titles.jsx` and `scripts.ts`. |
