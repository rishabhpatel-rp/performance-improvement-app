# PagePulse Performance — Complete Project Flow

> **Single authoritative doc for this checkout.** Rebuilt by reading the
> source tree — not by treating an older PROJECT_FLOW as law. If this file
> and the code disagree, **the code wins**; then update this file.
> Do not restore older names (`performance_scripts.liquid`,
> `/apps/my-first-custom-app`, dummy `api.script.jsx` as the storefront path).

---

## 0. What this checkout is (read first)

This folder is **not** the live PagePulse deployment. Do not treat it as
production, and do not assume the app is already installed anywhere here.

| Layer | What it actually is |
|---|---|
| **Git / this workspace** | A clone of the **already-shipped** PagePulse source (`performance-improvement-app`). We pulled live-app code into git so we can read and run it locally. |
| **This Node process** | `shopify app dev` on a developer machine. Shopify CLI tunnels the local server (`*.trycloudflare.com`) and rewrites `SHOPIFY_APP_URL` because `automatically_update_urls_on_dev = true`. |
| **Local Postgres** | `localhost:5432` / `performance_app` from `docker-compose.yml`. **Empty of merchant fleet data.** Not the production Brainvire database. |
| **Current test shop** | A **new destore that did not have this app**. First install happens here. No Store row, no `$app:script_injector_config` instance, no theme embed, no audit arrays until we create them. |
| **Partner listing URL in TOML** | `https://pagepulsespeed.node.brainvire.dev` is the **existing live listing’s** `application_url`. It is not this clone. A 502 there does not mean this destore is broken. |

**Known destore used in this work:**
`rishabh-dev-store-mdqu0epm.myshopify.com` (Rishabh-Dev-Store, Brainvire
org `129007517`, storefront password `1`). First PagePulse install on that
shop was done from this clone.

**Rejected for this clone:** `dev-test-store-vohzxcoa.myshopify.com` sits
in a different Partner org and cannot install the Brainvire PagePulse
`client_id`.

### Rules for every AI in this workspace

- Do **not** write or act as if “the app is already live on this store.”
- Do **not** point destore traffic at `pagepulsespeed.node.brainvire.dev`
  and call that “this app.” Destore App Proxy must hit **this** tunnel.
- Do **not** expect existing `Store` / `StoreConfig` / audit results on
  first dashboard open. That is the **first-install** path (§19).
- “Live path” in later sections means **which file the Liquid block
  actually calls in this codebase**, not “this checkout is production.”
- Do not invent `.env` keys. CLI writes API key/secret/app URL. The only
  hand-written local value is `DATABASE_URL` for compose Postgres.

---

## 0.1 How another AI should use this file

1. Read **§0** (this clone vs the shipped listing vs the new destore).
2. To install after a git clone, follow **§16** (full runbook). Do not
   invent a second procedure.
3. Read **§1–§3** (what the code does, two apps, two TOML configs).
4. Before changing a feature, jump to **§18** (“where do I change X”).
5. Before claiming storefront behavior, read **§10** (wired proxy path)
   and **§17** (leftover files that look wired but are not).
6. Dashboard open-speed work is **already in this code**. Read **§7.0**
   before touching the loader. Do not re-serialize Shopify calls.
7. On a new destore, assume first install until a `Store` row exists.
8. Constants: **§22**. GraphQL list: **§23**. Leftover files: **§17** +
   **§24**. Admin-panel route/API map: **§20**.

---

## 1. What this project is

**PagePulse** (repo `performance-improvement-app`, Partner app name
`PagePulse`) is a Shopify embedded app that makes a merchant storefront load
faster by:

1. Running a **hidden Playwright/Chromium audit** of Home + a PLP + a PDP
   (~30s settle per page).
2. Storing two lists in **Postgres** (not the theme):
   - **defer patterns** — third-party script filenames / hostnames
   - **hide selectors** — CSS selectors that were off-screen on every audited page
3. Serving a compiled, **obfuscated** storefront bundle through Shopify
   **App Proxy**. The theme embed is a thin Liquid fetcher. It does **not**
   contain the defer logic.

A second, **internal-only** Next.js app (`/admin-panel`) reads the same
Postgres so Brainvire can see every install. Merchants never see it.

| Module | Path | Framework | Audience | Purpose |
|---|---|---|---|---|
| Shopify app | `/app`, `/extensions` | React Router 7 + `@shopify/shopify-app-react-router` | Merchant, inside Admin | Wizard, audit, config, storefront JSON |
| Admin panel | `/admin-panel` | Next.js 15 App Router | Internal team only | Fleet dashboard, store detail, activity |

They are **two Node processes**. The root `Dockerfile` builds only the
Shopify app. In production they share **one Postgres**. **In this
checkout** the Shopify app uses local compose Postgres only. Do not
point this clone at a production `DATABASE_URL` unless the developer
explicitly gives one.

---

## 2. Two Shopify CLI app configs (do not mix)

| File | App name | `client_id` | Org that owns it | When to use |
|---|---|---|---|---|
| `shopify.app.pagepulse.toml` | **PagePulse** | `20ab28b1c9809df789897f44095a86cd` | Brainvire `129007517` | **Default.** `shopify app dev --config pagepulse` |
| `shopify.app.toml` | Performance-improvement-app | `f3c38e708010aaa3be8bcdc18e3e03a6` | Older / other listing | Only if the user names that app |

Both TOML files still name the **shipped listing** URL:

- `application_url = https://pagepulsespeed.node.brainvire.dev`
  (Partner dashboard URL for the existing live app — **not** this clone)
- `[build] automatically_update_urls_on_dev = true` — while **this**
  `shopify app dev` is running, CLI replaces app URL / redirect / proxy
  target with the current Cloudflare tunnel. The destore then talks to
  **this** machine, not the Brainvire host.
- App proxy: `prefix=apps`, `subpath=performance-scripts`,
  `url=/api/storefront-scripts`
- Metaobject `$app:script_injector_config` (same fields)
- Webhooks API `2026-10`: `app/uninstalled`, `app/scopes_update`

**PagePulse-only extras** (`shopify.app.pagepulse.toml`):

- Compliance webhooks → `/webhooks/compliance`
  (`customers/data_request`, `customers/redact`, `shop/redact`)
- Extra scopes: `read_products,read_reports` (on top of
  `read_themes,write_app_proxy,write_metaobject_definitions,write_metaobjects,write_products`)
- `[access.admin] embedded_app_direct_api_access = true`,
  `direct_api_mode = "online"`

A store **must** live in the same Partner org as the chosen `client_id`.
PagePulse cannot attach to a store in another org (this failed for
`dev-test-store-vohzxcoa` in “Rishabh Custom Store” `206210682`).
Known working Brainvire store:
`rishabh-dev-store-mdqu0epm.myshopify.com` (storefront password `1`).

---

## 3. Top-level repository layout

```
PagePulse-Performance/
├── app/                          # Shopify embedded app (React Router)
│   ├── components/               # Wizard UI only
│   ├── lib/                      # All business logic (see §18)
│   ├── routes/                   # Flat file routes → URLs
│   ├── types/script.ts           # AppConfig, AppConfigInput, PredefinedScript
│   ├── db.server.js              # Prisma singleton (global.prismaGlobal in dev)
│   ├── shopify.server.js         # shopifyApp() bootstrap
│   ├── root.jsx                  # HTML shell + Inter font
│   ├── entry.server.jsx          # SSR stream, 5s timeout, Shopify CSP headers
│   └── routes.js                 # export default flatRoutes()
├── extensions/script-injector/   # Theme App Extension
│   ├── blocks/performance-loader.liquid   # wired embed (handle: performance-loader)
│   ├── locales/en.default.json            # leftover key "performance_scripts"
│   └── shopify.extension.toml             # name "Script Injector"
├── prisma/
│   ├── schema.prisma             # Shopify-app schema (source of truth for DB)
│   └── migrations/               # 8 SQL migrations (see §14)
├── admin-panel/                  # Separate Next.js 15 app
│   ├── src/app/                  # App Router pages + /api/*
│   ├── src/lib/                  # auth, queries, dummy-data, prisma
│   └── prisma/schema.prisma      # DRIFTED copy — fewer columns (see §17)
├── shopify.app.pagepulse.toml    # PagePulse (default)
├── shopify.app.toml              # older listing
├── shopify.web.toml              # predev/dev + unset PLAYWRIGHT_BROWSERS_PATH
├── react-router.config.ts        # allowedActionOrigins = SHOPIFY_APP_URL host
├── docker-compose.yml            # postgres:16-alpine, db performance_app
├── Dockerfile                    # Node 20 Alpine + system Chromium
├── .cursor/skills/install-performance-app/SKILL.md
└── PROJECT_FLOW.md               # ← this file
```

**There is no `performance_scripts.liquid`.** The wired block filename in
this repo is `performance-loader.liquid`. Handle in theme
`settings_data.json` and deep links: `performance-loader`. On a **new**
destore that file is not in the theme until the merchant enables the
embed in the theme editor (Step 1 blocks ON until they do).

---

## 4. Shopify app tech stack & bootstrap

### 4.1 Stack

- React Router 7 framework mode, `@react-router/fs-routes` (dot filenames).
- `@shopify/shopify-app-react-router` — OAuth, sessions, webhooks, App Bridge.
- Polaris **web components** (`<s-page>`, `<s-switch>`, …), not Polaris React.
- Prisma 6 + PostgreSQL. Sessions: `PrismaSessionStorage` → `Session` table.
- Playwright `chromium` — **server only**. Never shipped to the browser.
- `javascript-obfuscator` — storefront bundle only.
- Admin API version: `ApiVersion.July26` in `app/shopify.server.js`;
  webhooks listed as `2026-10` in TOML.

### 4.2 `app/shopify.server.js`

`shopifyApp({ apiKey, apiSecretKey, apiVersion: July26, scopes from SCOPES
env (comma-split), appUrl, authPathPrefix: "/auth",
sessionStorage: PrismaSessionStorage(prisma), distribution: AppStore,
future.expiringOfflineAccessTokens: true, optional customShopDomains })`.

Exports: `authenticate`, `unauthenticated`, `login`, `registerWebhooks`,
`sessionStorage`, `addDocumentResponseHeaders`.

### 4.3 `app/db.server.js`

One `PrismaClient`. In non-production it is cached on `global.prismaGlobal`
so Vite HMR does not leak connections.

### 4.4 `app/entry.server.jsx`

`renderToPipeableStream` + `ServerRouter`. Bots: `onAllReady`. Humans:
`onShellReady`. `streamTimeout = 5000` but the abort timer is
`streamTimeout + 1000` → **6s**. Always calls
`addDocumentResponseHeaders` (CSP / frame-ancestors for Admin embed).

### 4.5 `react-router.config.ts`

`allowedActionOrigins` = host of `SHOPIFY_APP_URL`. Needed because the CLI
tunnel is HTTPS in the browser and HTTP on the Node request URL; without
this every `useFetcher` POST is 400 CSRF.

### 4.6 `shopify.web.toml`

```
predev = npm exec prisma generate
dev    = env -u PLAYWRIGHT_BROWSERS_PATH npm exec prisma migrate deploy
         && env -u PLAYWRIGHT_BROWSERS_PATH npm exec react-router dev
```

Cursor injects `PLAYWRIGHT_BROWSERS_PATH=/tmp/cursor-sandbox-cache/...`
which is empty. Unset it or audits fail with “Executable doesn't exist”.
Real Chromium lives under `~/.cache/ms-playwright`. Docker uses
`CHROMIUM_PATH=/usr/bin/chromium-browser` +
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. `audit.server.ts` passes
`executablePath: process.env.CHROMIUM_PATH` when set.

### 4.7 `app/lib/shopify.js`

Legacy helper `getThemeEditorDeepLink(shop, blockId)` →
`https://{shop}/admin/themes/editor?context=app`. **Not used** by the
wizard. The destore deep link is `getAppEmbedDeepLink` in
`theme-embed.server.js`.

### 4.8 Vite (`vite.config.js`)

- Dev HTTP port: `process.env.PORT || 9001`
- Local HMR: `ws` on **64999**
- Tunnel HMR: `wss`, `FRONTEND_PORT || 8002`, `clientPort: 443`
- Deletes leftover `HOST` after copying it (Shopify CLI quirk)
- Plugins: `reactRouter()`, `vite-tsconfig-paths()`
- `assetsInlineLimit: 0`, `optimizeDeps.include: @shopify/app-bridge-react`
- `server.fs.allow`: `app`, `node_modules`

Docker / `react-router-serve` listens on **3000** (`EXPOSE 3000`). Do not
confuse that with Vite 9001.

### 4.9 `tsconfig.json`

Includes `env.d.ts` — **that file is not in the repo**. Excludes
`admin-panel`, `node_modules`, `build`, `.react-router`. `allowJs` +
`strict`. Types: `@react-router/node`, `vite/client`,
`@shopify/polaris-types`.

### 4.10 `.graphqlrc.js`

Admin API project, `ApiVersion.July26`, documents `./app/**/*` plus
`./app/.server/**/*` (that folder **does not exist**). Output
`./app/types`. Extension schemas only if
`extensions/{name}/schema.graphql` exists (script-injector has none).

### 4.11 `.mcp.json`

Optional Cursor MCP: `npx -y @shopify/dev-mcp@latest`. Not required to
run the destore.

---

## 5. Routing map (every file under `app/routes/`)

Flat routes: `api.audit.start.jsx` → `/api/audit/start`.

| File | URL | Auth | Purpose |
|---|---|---|---|
| `_index/route.jsx` | `/` | none | Redirect to `/app` + preserve query (`shop`, `embedded`, `host`) |
| `auth.$.jsx` | `/auth/*` | `authenticate.admin` | After OAuth: `ensureConfig(admin)` then null |
| `auth.login/route.jsx` | `/auth/login` | `login()` | Standalone shop-domain form |
| `auth.login/error.server.jsx` | — | — | Maps login errors to field messages |
| `app.jsx` | `/app` layout | `authenticate.admin` | Returns **only** `{ apiKey }`. Nav: Dashboard / App extension / Settings. `<AppProvider embedded>` |
| `app._index.jsx` | `/app` | `authenticate.admin` again | **Wizard.** Loader + all dashboard `intent`s. See §7–§8 |
| `app.extension.jsx` | `/app/extension` | admin | Embed on/off + theme-editor deep link. `?from=toggle` auto-opens editor |
| `app.settings.jsx` | `/app/settings` | admin | Debug toggle, link to `/app/extension`, “Reset all data” |
| `api.audit.start.jsx` | `/api/audit/start` POST | admin | Manual re-audit (skips if already complete and not running) |
| `api.audit.status.jsx` | `/api/audit/status` GET | admin | `{running,complete,failed,error,pageIndex,totalPages,progress}` from `StoreConfig` |
| `api.storefront-scripts.jsx` | `/api/storefront-scripts` GET+POST | **App Proxy** | **Wired storefront JSON** (what Liquid fetches). See §10 |
| `api.script.jsx` | `/api/script` GET | App Proxy | **Leftover.** Dummy JS bundle. Liquid in this repo does not call this |
| `api.step-3.jsx` | `/api/step-3` POST | admin | Returns `PREDEFINED_SCRIPTS` (empty array today) |
| `api.save-performance-scripts.jsx` | `/api/save-performance-scripts` POST | admin | Upserts `PerformanceScript` raw text. **Not used by the wired proxy** |
| `webhooks.app.uninstalled.jsx` | `/webhooks/app/uninstalled` | webhook HMAC | Soft-delete store, log, best-effort metaobject + Session delete |
| `webhooks.app.scopes_update.jsx` | `/webhooks/app/scopes_update` | webhook | Session.scope + `Store.currentScope` + activity |
| `webhooks.compliance.jsx` | `/webhooks/compliance` | webhook | GDPR: data_request/redact no-op; `shop/redact` → `eraseShopData` |

There is **no** `/audit-submit` route in `app/routes/`. Dashboard still
writes `SHOPIFY_APP_URL/audit-submit` onto metaobject `app_endpoint`
(`ensureAppEndpoint`) for a planned storefront POST that does not exist yet.

---

## 6. Two sources of truth (do not invert)

| Data | Source of truth | Written by | Why |
|---|---|---|---|
| `appEnabled`, `script1/2/3Enabled`, `scriptTitles`, `debugMode`, `auditComplete` (flag copy), `appEndpoint` | Shopify metaobject `$app:script_injector_config` | `app/lib/metaobjects.ts` | Portable flags inside Shopify |
| `auditDeferArray`, `auditHideSelectors`, `staticDeferDefaults` | **Postgres `StoreConfig`** | `saveAuditReport`, `updateAuditArrays` | Too large / volatile for comfortable metaobject use |
| Per-field ON/OFF + preserved snapshots | **Postgres only** | `updateAuditFieldToggle` | Never on the metaobject |
| `storefrontPassword`, `customPlpUrl`, `customPdpUrl` | **Postgres only** | dashboard intents | Never on the metaobject |
| Audit lifecycle (`auditRunning/Failed/Error/PageIndex/TotalPages/lastAuditAt`) | **Postgres only** | `startHiddenAudit` / status poller | |
| Shop identity (name, address, plan, product count, …) | Shopify Admin, mirrored to `Store` | `fetchShopDetailsFromShopify` + `upsertStore` | For admin-panel / local DB only, **not** painted on the wizard |
| Compiled storefront JS/CSS | Generated **on each proxy request** from DB arrays | `generateDeferredScript` + `buildHiddenCss` | Not read from `PerformanceScript` |

`syncConfigToDatabase` **mirrors flags** into Postgres on dashboard load.
On **update** it deliberately does **not** write `auditComplete` or the
three audit arrays, so a routine load cannot clobber a finished audit with
empty metaobject lists.

Loader overlay: if DB arrays are non-empty they **win** over the
metaobject copy. Toggles and preserved snapshots always come from DB.

---

## 7. What transfers before the dashboard paints

On the destore, opening PagePulse remounts `/app`. **Two** loaders run.
The first visit is a **first install**: `upsertStore` creates the `Store`
row; `ensureConfig` creates the metaobject if Shopify has none yet;
`StoreConfig` may still be empty. The browser only receives a small
wizard JSON. Heavy Shopify payloads stay on the server.

```
Browser GET /app
  → app.jsx loader: authenticate.admin  →  { apiKey }
  → app._index.jsx loader: authenticate.admin AGAIN
       → Promise.all (3s timeout each):
            A. ShopDetails GraphQL + upsert Store
            B. ensureConfig (1 metaobject query) + maybe ensureAppEndpoint
            C. isAppEmbedEnabled (1 theme + settings_data.json query)
            D. Prisma Store + StoreConfig (one read)
       → if B succeeded: syncConfigToDatabase (flags only)
       → if first-ever Store row: logActivity("installed")
       → overlay DB arrays/toggles/password/custom URLs
  → Browser receives:
       { config, auditStatus, embedEnabled, embedActivateUrl }
```

Warm loads measured after the parallel rewrite: **~410–466ms**
(`console.log` line `[Dashboard] loader ${ms}ms shopifyConfig=… embed=…`).
Before that rewrite these calls were serial (6–8 Admin RTTs + 3 Prisma
reads) and the iframe sat 8–15s or blank.

### 7.0 Already done — dashboard fast preview (do not redo)

This work is **in the tree**. AIs cloning from git must not “optimize
the slow dashboard” by adding dummy data, removing Shopify calls, or
reverting to serial `await`. If Admin → PagePulse is still slow on a
new destore, check tunnel / auth / first-install writes first — not
this loader shape.

| Change (done) | File | What it does | Do not regress |
|---|---|---|---|
| Parallel loader | `app/routes/app._index.jsx` | `Promise.all([shop sync, ensureConfig+endpoint, isAppEmbedEnabled, one Prisma Store+StoreConfig])` | Do not `await` A then B then C again |
| 3s fail-fast | `app/lib/shopify-timeout.server.ts` (`SHOPIFY_CALL_TIMEOUT_MS = 3000`) | Each Shopify block is wrapped in `withShopifyTimeout` | On timeout use last `StoreConfig`. Never invent `appEnabled=true` or fake audit arrays |
| One metaobject read | `app/lib/metaobjects.ts` `fetchConfigMetaobject` | `ensureConfig` is one `GetConfig` query (id + fields) | Do not add a second `getConfig` / `findConfigId` round-trip on the happy path |
| Skip no-op endpoint write | `ensureAppEndpoint(admin, endpoint, currentConfig)` | If `app_endpoint` already equals `SHOPIFY_APP_URL/audit-submit`, **no** `metaobjectUpdate` | Do not call `getConfig` again inside `ensureAppEndpoint` when `currentConfig` was just loaded |
| One theme+file query | `app/lib/theme-embed.server.js` `MainThemeSettings` | MAIN theme + `config/settings_data.json` in **one** Admin query; needle `/blocks/performance-loader/` | Do not query themes then files as two calls |
| One Prisma read | `app._index.jsx` `STORE_CONFIG_SELECT` | Flags, audit lifecycle, password, custom URLs, arrays, toggles, preserved | Do not `findUnique` Store three times in the loader |
| Overlay + log | same loader | Shopify flags win when the call succeeded; DB arrays/toggles always win; `installed` activity only if `isNewStore` | Do not let `syncConfigToDatabase` overwrite audit arrays on update |
| Timing log | `[Dashboard] loader ${ms}ms shopifyConfig=… embed=…` | Evidence for warm ~410–466ms | Keep the log |

**Still not done (do not pretend):** `app.settings.jsx` is still serial
and has no timeout. Dual `authenticate.admin` (layout + index) is
required by nested routes — do not “fix” that by dropping layout auth.

**Related storefront fix already in this tree** (same working session):
`api.storefront-scripts.jsx` compiles from `StoreConfig` arrays +
`buildHiddenCss`. Never pass `PerformanceScript.auditScript` (that
column is `JSON.stringify(report)`) into `generateDeferredScript`.

### 7.1 Layout (`app.jsx`)

- `authenticate.admin(request)` — session cookie / App Bridge token.
- Returns `{ apiKey: process.env.SHOPIFY_API_KEY }`.
- Renders `<s-app-nav>`: `/app`, `/app/extension`, `/app/settings`.

### 7.2 Parallel block A — shop sync

`fetchShopDetailsFromShopify` query `ShopDetails`:

- `shop { id, name, email, url, myshopifyDomain, shopAddress { country,
  countryCode, city, address1, address2, zip }, ianaTimezone,
  timezoneAbbreviation, currencyCode, plan { displayName }, createdAt,
  updatedAt }`
- `productsCount { count }`

Mapped into `Store` via `upsertStore`. `shopifyShopId` = GID
(`gid://shopify/Shop/…`), not the domain. Reinstall sets `isActive=true`
and clears `uninstalledAt` so a later `shop/redact` does not wipe a new
install. `session.scope` is written onto `currentScope`.

**Not sent to the wizard.** Admin-panel / local `Store` row only.

**Query vs mapper mismatch (code as written):** the GraphQL selection
has `productsCount` but **no** `ordersCount` and **no** `shop.locale`.
`fetchShopDetailsFromShopify` still reads `data.data?.ordersCount?.count`
and `shop.locale`. On this destore those land as `undefined`.
`Store.totalOrders` / `Store.locale` stay empty unless something else
writes them. Do not invent a fallback count.

On timeout/error: log, continue with `{ shopData: null, isNewStore: false }`.

### 7.3 Parallel block B — config metaobject

`ensureConfig` → one query `GetConfig` (`metaobjects(first:1, type:
"$app:script_injector_config")`) + `ConfigFields` fragment.

If missing: create with all flags false. If definition not deployed
(`No metaobject definition exists`): return `defaultAppConfig()`, do not
crash.

Then `ensureAppEndpoint(admin, `${SHOPIFY_APP_URL}/audit-submit`, config)`
**only if** the stored URL differs. Matching URL = no write.

Timeout → `shopifyConfig = null` → use last `StoreConfig` via
`configFromDbRow`. Never invent “app on” or fake arrays.

### 7.4 Parallel block C — theme embed

One query `MainThemeSettings`:

```
themes(first: 1, roles: [MAIN]) {
  nodes { id, files(filenames: ["config/settings_data.json"]) { nodes { body { content } } } }
}
```

`embedEnabledInSettings(content, "performance-loader")`:

- needle `/blocks/performance-loader/`
- if missing → embed never enabled → `false`
- if present, look at `"disabled": true|false` in the next 500 chars
- disabled true → `false`; else `true`

On GraphQL failure the helper returns `null`. Loader then does
`embedEnabled = embedCheck !== false`, so **unknown does not lock Step 1**.
Only an explicit `false` locks the master switch.

Deep link (browser only, no extra transfer):

```
https://admin.shopify.com/store/{handle}/themes/current/editor
  ?context=apps&activateAppId={SHOPIFY_API_KEY}/performance-loader
```

### 7.5 Parallel block D — Postgres

One `store.findUnique({ shopDomain: session.shop, select: { configs:
{ select: STORE_CONFIG_SELECT } } })`.

`STORE_CONFIG_SELECT` includes flags, audit lifecycle, password, custom
URLs, three arrays, three enabled flags, three preserved snapshots.

### 7.6 After Promise.all

1. `mergedConfig` = Shopify config **or** DB **or** `DEFAULT_CONFIG`.
2. `safeSyncConfig` only if Shopify read succeeded.
3. `auditStatus` from DB (`progress = round(pageIndex/totalPages*100)`).
4. First-install `StoreActivity` if `isNewStore`.
5. Overlay non-empty DB defer/hide; static defaults fall back to
   `["wpm","gtm","clarity"]` if DB empty.
6. Return `{ config: finalConfig, auditStatus, embedEnabled, embedActivateUrl }`.

`finalConfig` fields the React wizard uses:

```
appEnabled, script1/2/3Enabled, scriptTitles, debugMode,
auditDeferArray, auditHideSelectors, staticDeferDefaults,
auditDeferArrayEnabled, auditHideSelectorsEnabled, staticDeferDefaultsEnabled,
auditDeferArrayPreserved, auditHideSelectorsPreserved, staticDeferDefaultsPreserved,
auditComplete, appEndpoint, storefrontPassword, customPlpUrl, customPdpUrl
```

### 7.7 Timeouts

`app/lib/shopify-timeout.server.ts`: `SHOPIFY_CALL_TIMEOUT_MS = 3000`.
`Promise.race` + labeled error `[ShopDetails] timed out after 3000ms`.

**Settings** (`app.settings.jsx`) is **not** parallelized and has **no**
timeout. It still does `getConfig` + `syncConfigToDatabase` serially.

### 7.8 Client after paint

- If `expectingAudit` or `auditStatus.running`: poll
  `GET /api/audit/status{window.location.search}` every **1s** (not 3s).
- If embed off: on `focus` / `visibilitychange` → `revalidator.revalidate()`.
- Toggle-ON is optimistic via fetcher `formData` so the spinner starts
  before the action returns.

---

## 8. Wizard UI and every `action` intent

2 steps. Labels in `WizardProgress.jsx`: `["Start", "Scripts"]`.
`maxStep = appEnabled && auditStatus.complete ? 2 : 1`.
`appEnabled` is forced `false` in the UI when `embedEnabled` is false.

### 8.1 Step 1 — `Step1Activate.jsx`

- Master switch → `intent: "toggle-app"`, `appEnabled: "true"|"false"`.
- If merchant tries ON while embed is off: **does not POST**. Opens
  `/app/extension?...&from=toggle` in a new tab.
- Password card (local `pwEnabled` switch, not persisted as a flag):
  `intent: "save-storefront-password"`. DB only.
- Custom PLP/PDP: `intent: "save-custom-page-urls"`. DB only. Empty
  string → `null` (audit then auto-discovers).
- Progress UI: assumes 30s/page, default 3 pages. Bar caps at 99% until
  poll says complete. Failed shows `auditStatus.error`.

### 8.2 Toggle-ON server path (`intent: "toggle-app"`, true)

1. Re-check `isAppEmbedEnabled`. If `false`, return
   `{ ok:false, error:"extension_required", embedEnabled:false, … }`
   and do **not** enable.
2. `updateConfig`: `appEnabled=true`, all three `scriptNEnabled=true`.
3. `resetAudit` — metaobject arrays `[]`, `audit_complete=false`.
4. `startHiddenAudit(admin, session.shop)` — sets `auditRunning=true`,
   returns immediately; Playwright runs in a floating async IIFE.
5. `safeSyncConfig` + `logActivity("config_changed")`.
6. Return `{ ok:true, config, auditRunning:true }`.

### 8.3 Toggle-OFF

`updateConfig({ appEnabled:false })` — does **not** clear individual
script flags. Then `resetAudit`, then DB upsert clearing
`auditRunning/Complete/Failed`, `lastAuditAt`, both audit arrays.
Activity logged.

### 8.4 Step 2 — `Step2Configure.jsx` + nested `Step3Titles.jsx`

`PREDEFINED_SCRIPTS` is `[]`, so **zero script-slot rows render**.
`script1/2/3Enabled` still exist on the metaobject and in `toggle-script`.

`Step3Titles` — three independent JSON-array textareas:

| Label | DB column | Storefront use |
|---|---|---|
| Defer Heavy Scripts | `auditDeferArray` | `generateDeferredScript` arg 1 (`var P`) — hold until interaction |
| Hide Lastfold Classes | `auditHideSelectors` | `buildHiddenCss` — `html:not(.interacted) {sel} { visibility:hidden !important }` |
| Delay Scripts | `staticDeferDefaults` | `generateDeferredScript` arg 2 — 6s timer every page load |

Each box:

- Toggle `intent: "toggle-audit-field"` (`updateAuditFieldToggle`).
  OFF: snapshot active → preserved, active = `[]`.
  ON: restore preserved (or keep active if preserved empty).
  Data is never deleted.
- Save `intent: "save-audit-arrays"` — only dirty valid JSON arrays of
  strings. If that field’s toggle is OFF, write `[]` regardless of
  textarea. **DB only.**

Dead intents still in the action (no current UI caller):
`save-titles`, `save-audit-defer`, `save-audit-hide` (these **do** write
the metaobject).

### 8.4a Dashboard `action` intents (complete)

| `intent` | Form fields | Writes | Used by |
|---|---|---|---|
| `toggle-app` | `appEnabled` true/false | Metaobject flags; ON starts audit; OFF `resetAudit` + clears DB audit arrays | `Step1Activate` |
| `toggle-script` | `scriptIndex` 0–2, `enabled` | Metaobject `scriptNEnabled` + DB sync | `Step2Configure` (no rows while `PREDEFINED_SCRIPTS` is `[]`) |
| `toggle-audit-field` | `field`, `enabled` | DB only via `updateAuditFieldToggle` | `Step3Titles` |
| `save-audit-arrays` | any of the 3 JSON arrays | DB only via `updateAuditArrays`; OFF field forced to `[]` | `Step3Titles` Save |
| `save-storefront-password` | `storefrontPassword` | `StoreConfig.storefrontPassword` (empty → `null`) | `Step1Activate` |
| `save-custom-page-urls` | `customPlpUrl`, `customPdpUrl` | `StoreConfig` (empty → `null`) | `Step1Activate` |
| `save-titles` | `scriptTitles` JSON | Metaobject — **no UI caller today** | — |
| `save-audit-defer` | `auditDeferArray` JSON | Metaobject — **no UI caller today** | — |
| `save-audit-hide` | `auditHideSelectors` JSON | Metaobject — **no UI caller today** | — |

Settings page intents (not on the wizard): POST without `intent` toggles
`debugMode`; `intent=reset` deletes the metaobject and zeroes flags.

`FooterBranding.jsx` (every wizard page): links
`https://www.brainvire.com/privacy-policy/`,
`https://www.brainvire.com/terms-of-use/`,
`mailto:shopify@brainvire.com`. Label still says “PERFORMANCE APP”.

### 8.5 `startHiddenAudit` (also mirrored in `api.audit.start.jsx`)

Requires a `Store` row (created by dashboard shop sync). If missing, logs
`SKIPPED — no Store row` and returns.

Reads `storefrontPassword`, `customPlpUrl`, `customPdpUrl`. Theme id only
fetched when a password exists (`getActiveThemeId` = most recently
**updated** theme, numeric id from GID).

`discoverPages` → `runHiddenAudit` → `saveAuditReport` → set
`auditComplete=true`, `auditRunning=false`. On error: `auditFailed=true`,
`auditError=message`.

`api.audit.start` extra: if `auditComplete && !auditRunning`, returns
`{ complete:true }` without re-running. Dashboard OFF→ON always resets
first, so it re-runs.

---

## 9. Hidden audit engine

Files: `app/lib/audit.server.ts`, `app/lib/audit-script.ts`.

### 9.1 `discoverPages(admin, shopDomain, password?, themeId?, customUrls?)`

1. Home always `https://{shopDomain}/`.
2. If merchant saved custom PLP/PDP, use those (no GraphQL for that slot).
3. Else Admin query `PageDiscovery`: `collections(first:1)`,
   `products(first:1)` → `/collections/{handle}`, `/products/{handle}`.
4. Else scrape homepage (Playwright, 45s `domcontentloaded`) with extra
   selectors (`/shop`, `/catalog`, `/product/`, …).
5. **Graceful degradation**: if no PLP and no PDP, warn and audit **home
   only**. Does **not** throw.
6. If password set, every URL gets
   `?password=…&preview_theme_id=…` (`appendPasswordBypass`).

### 9.2 `runHiddenAudit`

- `chromium.launch({ headless:true, executablePath: CHROMIUM_PATH })`.
- Persistent browser **context** so `localStorage` survives navigations.
- `page.addInitScript(buildAuditScriptWithPages(urls))` — only substitution
  in the verbatim script is `var PAGES=[];` → `var PAGES=[...]`.
- First navigation `networkidle` / 60s. If password form still visible,
  fill `input[name=password]` and submit.
- Progress: every 1s read `localStorage.shopAuditState_v1.currentIndex`.
- Wait until `currentIndex >= urls.length`, timeout
  `urls.length * 30000 + 60000`.
- Re-goto home, read `shopAuditP_v1`, `shopAuditVisible_v1`,
  `shopAuditOff_v1`.
- `deferArray` = sorted P. `hideSelectors` = off-screen keys **not** in
  the visible set. Always `browser.close()` in `finally`.

### 9.3 Verbatim audit script (`AUDIT_SCRIPT`)

**Do not rewrite.** `WAIT_MS = 30000` (doc comments that say 40s are
stale). `SIZE = 80` (min element px).

Per page after 30s:

- `auditP()`: every `<script src>` + `performance` script resources.
  Keep filename if it passes `passesPFilter` (not all-digits, not >5
  digits, not `www.` / `storefront` / `chunk`) **or** hostname if
  third-party. Excluded hosts: current host, `cdn.shopify.com`,
  `shop.app`, `checkout.shopify.com`, `cdn.shopifycloud.com`.
- `auditSelectors()`: “major” elements (has id/class, not tiny, not
  display:none). Visible vs off-screen via `getBoundingClientRect`.
  Sibling run from index ≥3 all off-screen → one
  `{container} > :nth-child(n+N)` selector. IDs/classes that look
  dynamic (`shopify-`, `section-`, hex, length>40, …) are skipped.

Then `location.href = PAGES[next]`. After last page, `outputFinal`
(console/clipboard — unused headlessly). Playwright reads the same keys.

### 9.4 `saveAuditReport`

If a field toggle is OFF, new audit results go to the **preserved**
column; active stays `[]`. Writes `PerformanceScript.auditScript =
JSON.stringify(report)` as a **history artifact**. Appends `AuditLog`
(`audit_type: "auto-audit"`).

**Storefront compile does not read `PerformanceScript`.** Passing that
JSON into `generateDeferredScript` is a past bug (it treated report keys
as script patterns). The wired proxy uses `StoreConfig` arrays only.

---

## 10. Storefront delivery (wired path in this codebase)

```
Theme (head)
  performance-loader.liquid
    fetch("/apps/performance-scripts", { credentials: "same-origin" })
      → Shopify App Proxy HMAC
      → app /api/storefront-scripts
      → JSON { success, data: { auditScript, hiddenCss } }
    if hiddenCss: <style> into document.head
    if auditScript: new Function(auditScript)()
    then remove the loader <script> node
```

### 10.1 Liquid (`extensions/script-injector/blocks/performance-loader.liquid`)

- Schema name: **Performance Script Loader**, `target: head`, no settings.
- No Liquid App Proxy signature helper — Shopify injects query params on
  the fetch URL when the request is same-origin on the shop domain.
- Password-protected storefronts: anonymous `curl` without the password
  cookie gets Shopify’s password **HTML**, which looks like a 500. Unlock
  the storefront (or send `_password` + digest) before judging the proxy.

### 10.2 `api.storefront-scripts.jsx`

- `authenticate.public.appProxy(request)`.
- Shop = `auth.session.shop` or `?shop=`.
- Load `Store` + latest `StoreConfig`.
- If `!store.isActive` or `!config.appEnabled` →
  `{ success:true, data:{ auditScript:"", hiddenCss:"" } }` (no-op).
- Else, respect per-field enabled flags (OFF → `[]`):
  - `auditScript = generateDeferredScript(deferArray, staticDefer)`
  - `hiddenCss = buildHiddenCss(hideSelectors)`
- Headers: `Content-Type: application/json`,
  `Cache-Control: private, no-store`.
- `action` handles POST + OPTIONS (204). Loader and action share
  `handleProxy`. Errors return `{ success:false }` **200-ish JSON**, not
  a thrown 500 (so Liquid’s `r.ok` path still parses).

Typical compiled `auditScript` is ~200–280KB after obfuscation.

### 10.3 Hide CSS

```
html:not(.interacted) {sel1},
html:not(.interacted) {sel2} { visibility: hidden !important; }
```

First interaction adds `interacted` on `<html>` (see §11), which lifts
the hide.

### 10.4 Present in the repo but not wired to the destore storefront

- `api.script.jsx` — dummy JS, two no-op scripts + empty style.
- `api.save-performance-scripts.jsx` — writes `PerformanceScript` rows
  the loader never reads.
- `app/lib/scripts.ts` dummies + empty `PREDEFINED_SCRIPTS`.
- `app/lib/shopify.js` old editor URL.

---

## 11. `generateDeferredScript(auditArray, deferArray)`

File: `app/lib/script-generator.js`. Server-only. Output is obfuscated
(`compact`, control-flow flattening, dead-code, RC4+base64 string array,
`disableConsoleOutput`, hex identifiers, `selfDefending: false` so
`new Function()` in Liquid still runs).

Three **independent** gates (a URL matching more than one is held by
each; release is whichever fires):

### 11.1 Interaction class

Listeners (once, capture, passive): `pointerdown, click, keydown,
touchstart, wheel, scroll, mousemove, focus`.

- First visit: add `f-interacted` on `<html>` until first interaction.
- On interact: add `interacted`, remove `f-interacted`, set
  `localStorage.__fInteractedDone=1`, dispatch `site:interacted`.
- Repeat visits: skip `f-interacted` if that key is already `"1"`.

### 11.2 Audit blocklist (`var P = auditArray`)

Monkey-patches `appendChild`, `insertBefore`, `replaceChild`,
`setAttribute`, plus drains `window.__dsq` / disconnects `window.__dsmo`
if a pre-loader queued scripts.

Matching `<script src>`: `type=text/plain`, `src` stripped, original
URL on `el._ps`. `MutationObserver` on `documentElement`. On
`site:interacted` (or if already interacted): rebuild real `<script>`
tags into `document.head`.

### 11.3 First-user delay (hardcoded, once per browser)

`FIRST_USER_DELAY_SCRIPTS = ["wpm","gtm","clarity"]`, **12s** or first
interaction, whichever first. `localStorage.__wpmDelayDone=1` so it
does **not** re-hold on later page views. Intercepts `HTMLScriptElement`
`src` setter.

This list is **not** the merchant’s Delay Scripts box. It is hardcoded
inside the generator.

### 11.4 Every-load delay (`var EVERY_TIME_DELAY_SCRIPTS = deferArray`)

Merchant “Delay Scripts” (`staticDeferDefaults`, default
`wpm,gtm,clarity`). **6s timer, every page load**, no interaction
requirement. Marks `data-et-deferred`.

`parseToArray` exists for string/CSV input; `api.storefront-scripts.jsx`
already passes string[].

---

## 12. Metaobject helpers (`app/lib/metaobjects.ts`)

`CONFIG_TYPE = "$app:script_injector_config"` — the `$app:` prefix is
required or Admin GraphQL finds nothing.

| Export | Behavior |
|---|---|
| `defaultAppConfig()` | All flags false; static defaults `wpm/gtm/clarity` |
| `getConfig` | One `fetchConfigMetaobject` |
| `updateConfig` | Partial field write; create if no id |
| `ensureConfig` | Get or create; swallow missing definition |
| `ensureAppEndpoint` | Skip write if URL already matches |
| `resetAudit` | arrays `[]` + `auditComplete=false` |
| `deleteConfig` | `metaobjectDelete` |

Booleans arrive as strings `"true"`/`"false"`. List fields are
JSON-encoded arrays; blank titles are stripped (Shopify rejects `""`).

`resolveAdmin` accepts either a `Request` or an already-authenticated
`admin` (webhooks have no session token to re-auth).

### 12.1 `app/lib/store-sync.server.ts` exports (all of them)

| Export | Used by (this app) | Notes |
|---|---|---|
| `DEFAULT_STATIC_DEFER` | `saveAuditReport` create path | `["wpm","gtm","clarity"]` |
| `fetchShopDetailsFromShopify` | dashboard loader | See query gap above |
| `upsertStore` | dashboard loader | Reinstall: `isActive=true`, `uninstalledAt=null` |
| `markStoreUninstalled` | `webhooks.app.uninstalled` | Soft delete |
| `eraseShopData` | `webhooks.compliance` `shop/redact` | Skip if active |
| `updateStoreScope` | `webhooks.app.scopes_update` | |
| `syncConfigToDatabase` | dashboard + settings | Update branch does **not** write audit arrays / `auditComplete` |
| `logActivity` | dashboard, settings, webhooks | |
| `getStoreWithDetails` | **no route caller** | Include configs + last 100 activities |
| `getAllStores` | **no route caller** | Search/filter/paginate; admin-panel has its own `getStores` |
| `getDashboardStats` | **no route caller** | Shopify-app copy; admin-panel has its own |
| `saveAuditReport` | `startHiddenAudit`, `api.audit.start` | Also upserts `PerformanceScript.auditScript` as report JSON |
| `readStringArray` | loader + storefront-scripts | Coerce Prisma Json → `string[]` |
| `updateAuditArrays` | `save-audit-arrays` | Partial patch |
| `updateAuditFieldToggle` | `toggle-audit-field` | Preserve/restore |

---

## 13. Webhooks & GDPR

### 13.1 `app/uninstalled`

Always: `markStoreUninstalled` (`isActive=false`, `uninstalledAt=now`)
+ `logActivity("uninstalled")` from payload `name` / `plan_name`.
If session+admin still exist: `deleteConfig`, then `session.deleteMany`.
Does **not** erase history (admin panel still shows Inactive).

### 13.2 `app/scopes_update`

Update `Session.scope` and `Store.currentScope`; log
`scope_updated` with previous/new.

### 13.3 Compliance (`webhooks.compliance.jsx`) — PagePulse TOML only

- `customers/data_request`, `customers/redact`: log only (no customer
  PII stored).
- `shop/redact`: `eraseShopData(shopDomain)` — **skip if `Store.isActive`**
  (reinstalled). Else transaction deletes Session, AppTracking, AuditLog,
  PerformanceScript, StoreActivity, StoreConfig, Store.

---

## 14. Shared database

### 14.1 Models (Shopify-app `prisma/schema.prisma`)

| Model | Writer | Reader | Notes |
|---|---|---|---|
| `Session` | PrismaSessionStorage | Shopify app | OAuth tokens |
| `Store` | upsert / uninstall / scope | Both | Fleet row |
| `StoreConfig` | Shopify app | Both (admin sees a subset) | 1:1 `storeId` unique |
| `StoreActivity` | `logActivity` | Both | `installed`, `uninstalled`, `config_changed`, `scope_updated` |
| `AdminUser` | Admin panel only | Admin panel | bcrypt |
| `PerformanceScript` | `saveAuditReport` + save-performance-scripts | Shopify app (unused by wired proxy) | `audit_script` / `defer_script` / `hidden_css` |
| `AppTracking` | **no writer** | — | Leftover |
| `AuditLog` | `saveAuditReport` + start-audit failure | Shopify app | History |

### 14.2 Shopify-app migrations (DDL as in `prisma/migrations/`)

| Folder | What the SQL actually does |
|---|---|
| `20260901095746_migrate_to_postgresql_add_models` | CREATE `Session`, `Store`, `StoreConfig` (early audit columns), `StoreActivity`, `AdminUser` |
| `20260902073700_drop_audit_columns` | DROP `StoreConfig.auditComplete`, `auditDeferArray`, `auditHideSelectors` |
| `20260903115942_add_static_defer_defaults` | ADD `staticDeferDefaults` JSONB; CREATE `AppTracking` |
| `20260903132030_add_audit_progress_columns` | ADD `auditPageIndex`, `auditTotalPages` |
| `20260903164006_reconcile_and_add_audit` | Re-ADD dropped audit columns; ADD `auditRunning/Failed/Error/lastAuditAt`; CREATE `performance_scripts`, `AuditLog` |
| `20260907113428_add_storefront_password` | ADD `storefrontPassword` |
| `20260907140000_add_audit_field_toggles` | ADD 3 `*Enabled` booleans + 3 `*Preserved` JSONB |
| `20260916112504_add_custom_page_urls` | ADD `customPlpUrl`, `customPdpUrl` |

`npx prisma migrate deploy` applies these. It is **not** a no-op.

Admin-panel `prisma/migrations/` stops after the **drop** migration. Do
not run that folder against the shared destore DB.

### 14.3 Admin-panel schema drift

`admin-panel/prisma/schema.prisma` has **no**
`PerformanceScript`, `AuditLog`, `AppTracking`, and `StoreConfig` only
has flags + `scriptTitles` + `metaobjectId`. No audit arrays, no
password, no custom URLs. `ConfigViewer` therefore cannot show audit
results. **Do not** run the admin-panel migrations against the shared
DB hoping to “sync” — they would drop columns the Shopify app needs.

Local compose: `postgres:16-alpine`, user `admin`, password
`devpassword123`, db `performance_app`, port `5432`. `init.sql`
enables `uuid-ossp`.

---

## 15. Environment

**Shopify app** (CLI writes most of `.env`; do not invent keys):

| Variable | Who sets it | Used for |
|---|---|---|
| `DATABASE_URL` | Developer / compose | Prisma |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SCOPES` / `SHOPIFY_APP_URL` | `shopify app dev` | OAuth, embed, endpoint |
| `SHOP_CUSTOM_DOMAIN` | optional | extra shop domain |
| `CHROMIUM_PATH` | Docker | Playwright binary |

**Admin panel** (`admin-panel/.env.example`):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Same Postgres |
| `ADMIN_SESSION_PASSWORD` | ≥32 chars; production throws if short |
| `SHOW_DUMMY_DATA` | First-visit default for demo cookie only |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | `prisma/seed.ts` only |

---

## 16. Install after a git clone (canonical runbook)

Anyone who clones this repo (human or AI) uses **this section**. Cursor
also has `.cursor/skills/install-performance-app/SKILL.md`; if they
drift, **this file wins** after you push `PROJECT_FLOW.md`.

This clone is **shipped PagePulse source** run with `shopify app dev`
against a **destore that may never have had the app**. It is not the
Brainvire host `pagepulsespeed.node.brainvire.dev`. First install =
empty local Postgres, no embed, no metaobject instance until OAuth +
dashboard.

| Constant | Value |
|---|---|
| Git repo | `https://github.com/rishabhpatel-rp/performance-improvement-app.git` |
| Default CLI config | `pagepulse` (`shopify.app.pagepulse.toml`) |
| Partner org | Brainvire `129007517` |
| App `client_id` | `20ab28b1c9809df789897f44095a86cd` |
| Admin open-app URL | `https://admin.shopify.com/store/<subdomain>/apps/20ab28b1c9809df789897f44095a86cd?dev-console=show` |
| App proxy | `/apps/performance-scripts` → `/api/storefront-scripts` |
| Local `DATABASE_URL` | `postgresql://admin:devpassword123@localhost:5432/performance_app?schema=public` |
| Playwright cache | `~/.cache/ms-playwright` — **never** `/tmp/cursor-sandbox-cache` |
| Destore used while writing this | `rishabh-dev-store-mdqu0epm.myshopify.com` (password `1`) |

Do not tell anyone the install is ready until the **Done checklist**
at the end of this section is all true.

### 16.1 Collect required details

Ask only for what is missing. Do not start until store domain is known.
Do not invent a store.

| Detail | Required | How to get it |
|---|---|---|
| Store domain | **Yes** | `*.myshopify.com`, or parse `admin.shopify.com/store/<subdomain>` |
| Storefront password | Yes if the shop has a password page | CLI `--store-password` + later unlock / audit |
| App config | No | Default `pagepulse`. Use `shopify.app.toml` only if they name that app |

```
Need two things to install:
1. Store domain (or admin URL), e.g. your-store.myshopify.com
2. Storefront password (dev-store password page), if it has one
```

### 16.2 Org check (before `app dev`)

```bash
shopify organization list --no-color
shopify store list --organization-id 129007517 --no-color
```

PagePulse’s `client_id` lives in **Brainvire**. CLI will not attach it
to a store in another org (failed for `dev-test-store-vohzxcoa` in
“Rishabh Custom Store”).

If the store is not in Brainvire: find it, **stop**, do not retry
`app dev` against that shop. Ask: Brainvire destore, new app in the
store’s org, or move the store.

### 16.3 Boot the repo

Skip steps that are already done.

1. If `package.json` is missing:
   `git clone https://github.com/rishabhpatel-rp/performance-improvement-app.git .`
2. Node must be `>=20.19 <22 || >=22.12`. If `node_modules` is missing:
   `npm ci` (needs network).
3. If `.env` has no `DATABASE_URL`, write **only** that line using the
   local URL above. Do **not** invent `SHOPIFY_API_KEY` / secret — CLI
   writes those on `app dev`.
4. Confirm Postgres on `localhost:5432` (`npx prisma migrate deploy`).
   If unreachable: `docker-compose up -d` from the repo root (may need
   docker group / sudo). If Docker is blocked, ask the developer. Do
   not change `DATABASE_URL` without asking.
5. `npx prisma generate && npx prisma migrate deploy` (8 migrations;
   see §14.2).

### 16.4 Playwright (audits fail without this)

Cursor injects `PLAYWRIGHT_BROWSERS_PATH=/tmp/cursor-sandbox-cache/...`
which is empty. Real Chromium is under `~/.cache/ms-playwright`.

Always:

1. Confirm `shopify.web.toml` `dev` unsets `PLAYWRIGHT_BROWSERS_PATH`
   on both `prisma migrate deploy` and `react-router dev`.
2. Start CLI with `env -u PLAYWRIGHT_BROWSERS_PATH`.
3. After boot, confirm the `react-router dev` child has **no**
   `PLAYWRIGHT_BROWSERS_PATH`.
4. Smoke-test (must print `playwright launch ok`):

```bash
env -u PLAYWRIGHT_BROWSERS_PATH node --input-type=module -e "
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
console.log('playwright launch ok', b.version());
await b.close();
"
```

Do **not** `npx playwright install` into the sandbox cache. If the
default cache is missing the binary:
`env -u PLAYWRIGHT_BROWSERS_PATH npx playwright install chromium`.

Docker images use `CHROMIUM_PATH=/usr/bin/chromium-browser` and
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

### 16.5 Start (or recycle) `shopify app dev`

If a previous `shopify app dev` is running, do **not** blindly reuse
it. Check the printed `trycloudflare.com` host still answers. If DNS
fails or storefront proxy is 500, kill that process and start a new
one.

From the repo root:

```bash
env -u PLAYWRIGHT_BROWSERS_PATH shopify app dev \
  --config pagepulse \
  --store <store>.myshopify.com \
  --store-password '<password>' \
  --skip-dependencies-installation \
  --no-color
```

Omit `--store-password` only when there is no password page.

Wait for `Preview URL` and `Ready, watching for changes`.

Benign noise (ignore):

- `No route matches URL "/json/version"`
- CLI sending `APP_UNINSTALLED` on first boot
- React Router v8 future-flag warnings
- Vite `chromium-bidi` warnings during Playwright import

`[build] automatically_update_urls_on_dev = true` rewrites this
clone’s `SHOPIFY_APP_URL` / proxy target to the **current** tunnel.
The destore then talks to this machine, not
`pagepulsespeed.node.brainvire.dev`.

### 16.6 Storefront script contract (do not regress)

Theme embed `extensions/script-injector/blocks/performance-loader.liquid`
does `fetch("/apps/performance-scripts")` and expects JSON:

```json
{ "success": true, "data": { "auditScript": "<js>", "hiddenCss": "<css>" } }
```

`app/routes/api.storefront-scripts.jsx` **must** compile from
`StoreConfig`:

- `auditDeferArray` / `staticDeferDefaults` / `auditHideSelectors`
- respect each field’s `*Enabled` toggle
- `generateDeferredScript(deferArray, staticDefer)` — both arguments
  are **string arrays**
- hide CSS from hide selectors (`html:not(.interacted) …`)

**Never** pass `PerformanceScript.auditScript` into
`generateDeferredScript`. That column is the raw audit report JSON
(`saveAuditReport` writes `JSON.stringify(report)`). Feeding it in
produces a huge broken bundle or a 500.

If this file has drifted back to `include: { performanceScript: true }`,
fix it before calling the app ready.

On a first-install destore with the app still OFF, `auditScript` and
`hiddenCss` are empty strings inside `success: true`. That is correct.

### 16.7 Mandatory verification (never skip)

Unlock the password page first (need `authenticity_token` from GET
`/password`, then POST). A request without the digest cookie gets
theme HTML 500/302 — **not** an app bug.

Then:

```bash
# Tunnel host from CLI "Using URL:" must be reachable from Shopify.
# Local DNS to trycloudflare.com can fail even when the shop proxy works.
# Trust the storefront proxy result below over a local curl of the tunnel.

curl -sS -b <store-cookies> -o /tmp/ps.json -w "%{http_code} %{content_type}\n" \
  "https://<subdomain>.myshopify.com/apps/performance-scripts"
```

Pass only if:

- HTTP **200**
- `Content-Type` includes `application/json`
- body has `"success":true` and `data.auditScript` (empty script is OK
  if the app toggle is off or no audit yet)
- body is **not** Shopify HTML containing
  `There was an error in the third-party application`

If the merchant already ran an audit and the app is ON, `auditScript`
should be non-empty obfuscated JS (~200–280KB) and `hiddenCss` should
contain `html:not(.interacted)`.

Also confirm:

- Preview URL opens the embedded wizard
- Opening Dashboard / App extension is a few hundred ms to a couple of
  seconds on a warm tunnel (`[Dashboard] loader …ms` in the server
  log). 8–15s blank iframe means the **old serial loader** or a hung
  Admin call — see §7.0 (already fixed in this tree).
- Theme editor deep link exists so they can enable
  **Performance Script Loader** in App embeds if it is off

### 16.8 What to give the developer

- **Install / open app:**
  `https://admin.shopify.com/store/<subdomain>/apps/20ab28b1c9809df789897f44095a86cd?dev-console=show`
- Theme editor link from CLI
- Local URL
- Storefront: `https://<subdomain>.myshopify.com/`
- What you verified (proxy status + JSON `success`)

Tell them to click **Install app** if Shopify prompts, then enable the
app embed if scripts still do not load. Do not paste GraphiQL keys or
store passwords.

### 16.9 Failure shortcuts

| Error | What to do |
|---|---|
| Store not found in organization Brainvire | Org mismatch — §16.2. Do not retry the same command. |
| Can't reach database `localhost:5432` | Start Postgres / ask for Docker. Do not invent a new `DATABASE_URL`. |
| Auth / login prompt | Developer runs `shopify auth login` in a real terminal, then rerun. |
| Playwright executable under `/tmp/cursor-sandbox-cache` | Restart with `env -u PLAYWRIGHT_BROWSERS_PATH`. Confirm child env. |
| `/apps/performance-scripts` 500 / “error in the third-party application” | Tunnel dead or app unreachable. Restart `shopify app dev`. Re-run §16.7. |
| Proxy 200 HTML instead of JSON | Password wall or proxy not applied. Unlock storefront; confirm app is installed and embed is on. |
| Proxy 200 JSON but `auditScript` empty while audit finished | Check `StoreConfig.appEnabled` and enabled toggles. Do not read `PerformanceScript`. |
| `generateDeferredScript` fed a JSON string / full report | Fix `api.storefront-scripts.jsx` — §16.6. |
| Dashboard 8–15s or blank | Loader should already be parallel + 3s timeout (§7.0). Check tunnel and server log `[Dashboard] loader`. Do not add dummy wizard data. |
| `pagepulsespeed.node.brainvire.dev` 502 | That is the **shipped listing** host, not this clone. Local `app dev` does not fix hosted prod. Only the tunnel-backed destore is in scope. |

### 16.10 Done checklist

```
- [ ] Store is in Brainvire (or developer approved a different plan)
- [ ] DATABASE_URL works; migrations applied
- [ ] PLAYWRIGHT_BROWSERS_PATH unset on react-router; chromium launches
- [ ] shopify app dev Ready; Preview URL printed
- [ ] api.storefront-scripts.jsx compiles from StoreConfig arrays
- [ ] GET /apps/performance-scripts → 200 application/json success:true
- [ ] Dashboard loader is the parallel + timeout version (§7.0), not serial awaits
```

### 16.11 Other run modes (not destore `app dev`)

- `npm run setup` = `prisma generate && prisma migrate deploy`.
- Docker: `npm ci --omit=dev`, `npm run build`, `docker-start` =
  setup + `react-router-serve ./build/server/index.js`.
- Theme extension ships with `shopify app deploy`, not the Node image.
- Admin panel: `cd admin-panel && npm run dev` — no Dockerfile in this
  repo. Against this clone it would see **local** destore rows only.

---

## 17. Leftovers / traps (current truth)

These are real. Do not “fix” them in docs by pretending they are wired.

1. **`api.script.jsx` is not used.** The Liquid in this repo fetches
   `/apps/performance-scripts` → `api.storefront-scripts.jsx`.
2. **`PREDEFINED_SCRIPTS = []`.** Step 2 script-slot list is empty.
   Dummy strings in `scripts.ts` are unused.
3. **`PerformanceScript.auditScript` is report JSON**, not executable JS.
   The wired compile is from `StoreConfig` arrays.
4. **Admin-panel Prisma schema is a subset.** Do not migrate it onto
   the shared DB.
5. **`locales/en.default.json`** still keys `blocks.performance_scripts`
   while the file is `performance-loader.liquid`. Cosmetic.
6. **`/audit-submit` is not implemented.** `app_endpoint` is still
   synced every dashboard load.
7. **`AppTracking` has no writer.**
8. **Settings loader** is still serial + untimeout’d.
9. **`getThemeEditorDeepLink` in `shopify.js`** is unused.
10. **Auth twice** on every `/app` load (layout + index). Required by
    nested routes; both call `authenticate.admin`.
11. **`embedCheck !== false`**: a failed embed read does not lock Step 1.
    An explicit `false` does.
12. **Hardcoded `wpm/gtm/clarity` 12s gate** inside the generator is
    separate from merchant Delay Scripts (6s every load).
13. **`ShopDetails` GraphQL** does not select `ordersCount` or
    `shop.locale`; mapper still reads them → `Store.totalOrders` /
    `Store.locale` stay unset on destore sync.
14. **`getStoreWithDetails` / `getAllStores` / `getDashboardStats`** in
    `store-sync.server.ts` have **no Shopify-app route caller**. The
    admin panel uses its own `src/lib/queries.ts`.
15. **Leftover backups (not imported):** `app/lib/store-sync.server.ts.org`,
    `app/components/FooterBranding.jsx.org`.
16. **`tsconfig.json` includes missing `env.d.ts`.**
17. **`api.script.jsx` comment** still says `performance_scripts.liquid`.
18. **`shopify.app.toml`** (non-pagepulse) has no compliance webhook and
    fewer scopes. Using `--config` default of pagepulse is required for
    `/webhooks/compliance` to be registered.

---

## 18. File-by-file: where do I change X?

| I want to change… | File |
|---|---|
| Step 1 copy, password, custom URLs, countdown | `app/components/Step1Activate.jsx` |
| Step 2 script slots | `app/components/Step2Configure.jsx` + `app/lib/scripts.ts` |
| Defer/hide/delay textareas | `app/components/Step3Titles.jsx` |
| Step labels / lock rules | `WizardProgress.jsx` + `maxStep` in `app._index.jsx` |
| Toggle-ON / audit kickoff / all intents | `app/routes/app._index.jsx` `action` + `startHiddenAudit` |
| Dashboard **load** parallelism / overlay | `app/routes/app._index.jsx` `loader` |
| Shopify call timeout | `app/lib/shopify-timeout.server.ts` |
| Metaobject read/write | `app/lib/metaobjects.ts` |
| Shop upsert, audit save, array toggle | `app/lib/store-sync.server.ts` |
| Page discovery / Playwright runner | `app/lib/audit.server.ts` |
| DOM audit heuristics / wait per page | `app/lib/audit-script.ts` (`WAIT_MS`) — **do not rewrite casually** |
| Embed detection / deep link | `app/lib/theme-embed.server.js` (`APP_EMBED_HANDLE`) |
| Wired storefront JSON (destore proxy) | `app/routes/api.storefront-scripts.jsx` |
| Obfuscated defer bundle | `app/lib/script-generator.js` |
| Theme fetcher | `extensions/script-injector/blocks/performance-loader.liquid` |
| App proxy path / scopes / metaobject fields | `shopify.app.pagepulse.toml` (or `shopify.app.toml`) |
| Playwright env in dev | `shopify.web.toml` |
| GDPR erase | `eraseShopData` in `store-sync.server.ts` + `webhooks.compliance.jsx` |
| Uninstall | `webhooks.app.uninstalled.jsx` |
| Postgres models (Shopify app) | `prisma/schema.prisma` + **new migration** |
| Admin panel KPIs | `admin-panel/src/lib/queries.ts` |
| Admin demo stores | `admin-panel/src/lib/dummy-data.ts` |
| Install after git clone (canonical) | **§16** in this file |
| Cursor shortcut for the same runbook | `.cursor/skills/install-performance-app/SKILL.md` (must match §16) |
| Dashboard load speed (already done) | **§7.0** — do not re-serialize |

---

## 19. Destore first-install flows (this checkout)

These steps are what happens on **this new destore**. Other merchants
on the shipped listing are a different environment and are not in
this local database.

### First install on the destore

1. `shopify app dev --config pagepulse --store rishabh-dev-store-mdqu0epm.myshopify.com`
   (or whichever Brainvire destore the developer names).
2. OAuth on that shop (never installed before).
3. `auth.$.jsx` → `ensureConfig` creates `$app:script_injector_config`
   **on this shop** if missing.
4. `/app` loader: `ShopDetails` → **creates** `Store` in **local**
   Postgres; `installed` activity; wizard Step 1; `appEnabled=false`;
   embed is **off** until someone toggles it in this shop’s theme
   editor.

### First enable on the destore

Merchant enables **Performance Script Loader** in **this** theme
(`/app/extension`). Then Step 1 ON → embed re-checked → flags on →
`resetAudit` → background Playwright against **this** storefront
(password `1` if saved) → poll `/api/audit/status` 1s → auto Step 2.
Arrays land in local `StoreConfig`. Destore storefront fetch compiles
from those arrays through the **current tunnel**.

### Destore customer / preview visit

Embed fetch → App Proxy → **this** local `/api/storefront-scripts`.
If app still off or embed still off, empty JSON. Else obfuscated JS +
hide CSS. Interaction (or 6s/12s timers) releases gates.

### Uninstall from the destore

Local `Store.isActive=false`; history kept in local DB. A later
`shop/redact` hard-deletes unless they reinstalled. This does not
touch production merchant rows.

### Internal admin panel (optional, same local DB)

If someone runs `/admin-panel` against this compose DB, they only see
stores created by **this clone** (plus demo dummy rows). Not the live
fleet.

---

## 20. Admin panel (internal) — code map

In **this checkout** the panel, if started, reads the **local** compose
database (this destore’s `Store` row plus optional dummy demo rows). It
is not the production fleet UI. It **never** calls Shopify.

Stack: Next.js 15 App Router, React 19, Tailwind 3, Recharts, Prisma
6.2 from `admin-panel/prisma/schema.prisma`, iron-session + bcryptjs
(cost 12). Path alias `@/*` → `./src/*`. Title: “Performance App Admin”.

### 20.1 Middleware (`src/middleware.ts`)

Matcher skips `/api/*`, `/_next/*`, `favicon.ico`. Checks **presence**
of cookie `admin-session` only (Edge cannot decrypt).

- `/login`, `/setup` — always pass
- `/` — cookie → `/dashboard`, else `/login`
- other pages — no cookie → `/login`

`/` `page.tsx` is the real gate: `requireAdmin()` → dashboard; else if
`hasAnyAdminUser()` is false → `/setup`; else `/login`.

### 20.2 Pages

| URL | File | Reads | Writes |
|---|---|---|---|
| `/` | `src/app/page.tsx` | session + AdminUser count | redirect |
| `/login` | `src/app/login/page.tsx` | — | POST `/api/auth/login` |
| `/setup` | `src/app/setup/page.tsx` | — | POST `/api/auth/setup` |
| `/dashboard` | `dashboard/page.tsx` | `getDashboardStats`, `getDemoMode` | — |
| `/dashboard/stores` | `stores/page.tsx` | `getStores({ search, status, page })` | — |
| `/dashboard/stores/[domain]` | `[domain]/page.tsx` | `getStoreByDomain` | — |
| `/dashboard/settings` | `settings/page.tsx` | `requireAdmin`, `getDemoMode` | client POSTs |
| `/dashboard/*` layout | `dashboard/layout.tsx` | `requireAdmin` | redirect `/login` |

Stores query params: `search` (name/domain/email, case-insensitive),
`status` = `active`|`inactive`|omitted, `page` (pageSize **20**).

### 20.3 API routes

| Method | Path | Auth | Body | Writes |
|---|---|---|---|---|
| POST | `/api/auth/login` | none | `{email,password}` | `lastLoginAt` + cookie |
| POST | `/api/auth/logout` | none | — | destroy cookie |
| POST | `/api/auth/setup` | none; 409 if any admin exists | `{email,password,name?}` min 8 | create + auto-login |
| POST | `/api/auth/update-profile` | `requireAdmin` | `{name?,email}` | name/email; email unique vs other users |
| POST | `/api/auth/change-password` | `requireAdmin` | `{currentPassword,newPassword}` min 8 | hash |
| POST | `/api/demo` | **none** | `{enabled:boolean}` | cookie `demo_mode` = `on`/`off` (1 year) |

Session cookie `admin-session`: httpOnly, sameSite lax, 7 days, secure
in production. Env `ADMIN_SESSION_PASSWORD` ≥32 chars; production
throws if short; dev fallback
`dev-only-insecure-session-password-change-me-32c` + console warning.

Seed (`prisma/seed.ts`, `npm run db:seed`):
`SEED_ADMIN_EMAIL` default `admin@performance-app.com`,
`SEED_ADMIN_PASSWORD` `admin123`, `SEED_ADMIN_NAME` `Admin`. Skips if
email exists.

### 20.4 Queries (`src/lib/queries.ts`)

- `getDashboardStats()` — always `store.findMany` + last 20
  `storeActivity`. Demo ON: concat `getAllDummyStores()` (32) +
  `DUMMY_ACTIVITIES` in RAM. KPIs: total/active/inactive,
  installed-in-7d, sum products, sum orders, `auditsCompleted`
  (counts `config.auditComplete` — **not a column on admin Prisma**,
  so real destore rows contribute **0**; only dummy stores count).
- `getStores` — demo OFF: Prisma where + skip/take. Demo ON: load all
  real + dummy, filter/sort/slice in memory.
- `getStoreByDomain` — real row wins; dummy only if missing and demo on.

**Admin-panel writes only `AdminUser`.** No writes to Store /
StoreConfig / StoreActivity.

### 20.5 Demo layer

- Cookie `demo_mode` `on`|`off`. No cookie → `SHOW_DUMMY_DATA==="true"`
  (`data-source.ts`).
- 32 dummy stores, seeded RNG `42`, ids `dummy_store_N`. ~67% active.
  First 5 installed in last 7 days. Event types include
  `audit_completed` (badge uses default color in `utils.ts`).
- `getDummyStores()` is exported and **unused**.
- Toggle: `TopBar` and Settings → POST `/api/demo` (unauthenticated).

### 20.6 UI components

| Component | Shows |
|---|---|
| `StatsCards` | 7 tiles listed above |
| `InstallsChart` | AreaChart, 30-day `installsByDay` |
| `CountryChart` | horizontal bar, top 10 `countryName??country??Unknown` |
| `PlanChart` | donut, `shopifyPlan??Unknown` |
| `StoreTable` | name (link), domain, email, country, status, installed, lastSynced |
| `StoreDetail` | tabs `config` (default) / `activity`; left card has address, plan, products, orders, scope, admin URL `https://{shopDomain}/admin` |
| `ConfigViewer` | **only** `appEnabled`, script1/2/3, debugMode, scriptTitles, metaobjectId, updatedAt |
| `ActivityTimeline` | `eventTypeLabel` / `eventTypeColor`: installed, uninstalled, scope_updated, config_changed, config_synced |
| `Sidebar` | Dashboard / Stores / Settings + logout |
| `Footer` branding on Shopify wizard is **not** this panel |

ConfigViewer **cannot** show destore audit arrays, password, custom
URLs, or audit lifecycle — those columns are absent from the
admin-panel Prisma client.

### 20.7 Admin schema vs Shopify-app schema

Missing models: `AppTracking`, `AuditLog`, `PerformanceScript`.

Missing `StoreConfig` columns: `auditComplete`, both audit arrays,
`staticDeferDefaults`, all 3 Enabled + 3 Preserved, `storefrontPassword`,
`customPlpUrl`, `customPdpUrl`, `auditRunning/Failed/Error`,
`lastAuditAt`, `auditPageIndex`, `auditTotalPages`.

Shared: flags, `scriptTitles`, `metaobjectId`, timestamps.

---

## 21. `AppConfig` TypeScript shape (`app/types/script.ts`)

```
appEnabled, script1Enabled, script2Enabled, script3Enabled,
scriptTitles: string[3],
debugMode,
auditDeferArray, auditHideSelectors, staticDeferDefaults,
auditDeferArrayEnabled, auditHideSelectorsEnabled, staticDeferDefaultsEnabled,
auditDeferArrayPreserved, auditHideSelectorsPreserved, staticDeferDefaultsPreserved,
auditComplete, appEndpoint
```

`storefrontPassword` / `customPlpUrl` / `customPdpUrl` are **not** on
`AppConfig`; the dashboard loader adds them onto the object it returns.

`PredefinedScript`: `id: script_1|script_2|script_3`, `name`,
`type: script|style`, `code`, `defaultEnabled`. Unused while the export
array is empty.

---

## 22. Timing / magic constants (from code)

| Constant | Value | File |
|---|---|---|
| Shopify Admin call timeout | 3000 ms | `shopify-timeout.server.ts` |
| SSR streamTimeout | 5000 ms | `entry.server.jsx` |
| SSR abort | 6000 ms | `entry.server.jsx` (`+ 1000`) |
| Audit wait per page | 30000 ms (`WAIT_MS`) | `audit-script.ts` |
| Audit max wait | `pages * 30000 + 60000` | `audit.server.ts` |
| Homepage scrape timeout | 45000 ms | `audit.server.ts` |
| First nav / re-goto home | 60000 ms | `audit.server.ts` |
| Password-form nav | 30000 ms | `audit.server.ts` |
| Progress / dashboard poll | 1000 ms | `audit.server.ts`, `app._index.jsx` |
| Step 1 UI seconds/page | 30 | `Step1Activate.jsx` |
| Storefront first-user delay | 12000 ms | `script-generator.js` (hardcoded wpm/gtm/clarity) |
| Storefront every-load delay | 6000 ms | `script-generator.js` (`staticDeferDefaults`) |
| Hide CSS gate | `html:not(.interacted)` | `api.storefront-scripts.jsx` |
| Major-element min size | 80 px (`SIZE`) | `audit-script.ts` |
| Vite dev port | 9001 | `vite.config.js` |
| Docker / serve port | 3000 | `Dockerfile` |
| Audit status progress | `round(pageIndex/totalPages*100)` | loader + `api.audit.status` |

---

## 23. Admin GraphQL operations used by this app

| Name | File | When |
|---|---|---|
| `ShopDetails` | `store-sync.server.ts` | Every dashboard load (parallel A) |
| `GetConfig` | `metaobjects.ts` | `ensureConfig` / `getConfig` |
| `UpdateConfig` / `CreateConfig` / `DeleteConfig` | `metaobjects.ts` | writes / uninstall |
| `MainThemeSettings` | `theme-embed.server.js` | embed check (1 query) |
| `ActiveTheme` | `audit.server.ts` | password audit only (sortKey UPDATED_AT) |
| `PageDiscovery` | `audit.server.ts` | collections(first:1) + products(first:1) unless custom URLs |

No Storefront API. No `ordersCount` query exists despite the mapper.

---

## 24. Files that exist but are not part of the destore path

| Path | Why it is leftover |
|---|---|
| `app/routes/api.script.jsx` | Dummy JS bundle; Liquid does not fetch it |
| `app/routes/api.step-3.jsx` | Returns empty `PREDEFINED_SCRIPTS` |
| `app/routes/api.save-performance-scripts.jsx` | Writes `PerformanceScript` text unused by proxy |
| `app/lib/scripts.ts` `SCRIPT_1_DUMMY` / `SCRIPT_2_DUMMY` | Never exported in the array |
| `app/lib/shopify.js` | Unused deep-link helper |
| `app/lib/store-sync.server.ts.org` | Backup |
| `app/components/FooterBranding.jsx.org` | Backup |
| `admin-panel/src/lib/dummy-data.ts` `getDummyStores` | Unused export |
| Product metafield `app.demo_info` + metaobject `app.example` in TOML | Shopify CLI template cruft |
| `prisma` model `AppTracking` | Delete-on-redact only |
| `/audit-submit` | Written to `app_endpoint`; **no route file** |
