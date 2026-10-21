# PagePulse Performance — Complete Project Flow

> **Single authoritative doc for this checkout.** Rebuilt by reading the
> source tree — not by treating an older PROJECT_FLOW as law. If this file
> and the code disagree, **the code wins**; then update this file.
> Do not restore older names (`performance_scripts.liquid`,
> `/apps/my-first-custom-app`, dummy `api.script.jsx` as the storefront path).

**Verification (2026-10-19):** Re-read against the tree; **do not delete** prior prose unless Appendix A marks it wholly wrong — add corrections beside it instead. When updating, **merge and correct in place**; keep superseded wording in place with a dated correction note (see §16.6, §28) rather than removing paragraphs.
Server-load / capacity: [`docs/server-load-reduce.md`](docs/server-load-reduce.md).

**Phase 3 pass 2 (GAP PROMPT_2, 2026-10-19):** Dead-code inventory §17.3; Appendix B `wc -l` regen; symbol tables §8.8.1, §9.5.5, §10.3.1, §10.4.1, §11.7.1, §12.2, §20.8.1, §25.1.

**Build state (re-run this session):**
| Check | Result |
|---|---|
| `npm test` | **113 pass, 6 skipped, 0 fail** (re-run this session) |
| `npm run lint` | **0 errors** — `node:process` in `theme-head-inject-utils.js`; `OverviewLighthouse` eslint waiver |
| `npm run typecheck` | **Fails** — see §17.4 (`HiddenAuditResult` drift, `.ts` import extensions) |

**Policy:** Trivial lint fixes were applied so `npm run lint` is trustworthy; TypeScript drift is tracked in §17.4 until a code pass aligns `HiddenAuditResult` / import extensions.

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
5. Before claiming storefront behavior, read **§10** (wired proxy path +
   inline metafields **§10.1**) and **§17** (leftover files that look wired
   but are not). Older notes that say “JSON fetch” are retained in **§16.6**
   with corrections — do not delete them.
6. Dashboard open-speed work is **already in this code**. Read **§7.0**
   before touching the loader. Do not re-serialize Shopify calls.
7. On a new destore, assume first install until a `Store` row exists.
8. Constants: **§22**. GraphQL: **§23**. Tests: **§26**. Ops: **§27**. Leftovers: **§17** (incl. §17.1–§17.2) + **§24**. PSI: **§25**. Corrections: **§28**. Admin-panel route/API map: **§20**.

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
│   └── migrations/               # 25 SQL migrations (see §14.2)
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
├── .playwright-mcp/              # Playwright MCP page snapshots (gitignored — §3, Appendix B)
└── PROJECT_FLOW.md               # ← this file
```

`.gitignore` line 40 lists `.playwright-mcp/` — not application source; safe to delete locally.

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

Flat routes use React Router FS naming (`api.foo.jsx` → `/api/foo`). Older
docs used the example `api.audit.start.jsx` → `/api/audit/start` — that
file is **gone** from this tree (table below + §5.1).

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
| `api.audit.status.jsx` | `/api/audit/status` GET | admin | `{running,complete,failed,error,pageIndex,totalPages,progress}` from `StoreConfig` |
| `api.dashboard-report.jsx` | `/api/dashboard-report` GET | admin | Step 3 audit summary (`loadDashboardAuditReportSummary`) |
| `api.embed-status.jsx` | `/api/embed-status` GET | admin | Embed status without full dashboard reload |
| `api.password-status.jsx` | `/api/password-status` GET | admin | Tri-state password protection for Step 1 |
| `api.storefront-scripts.jsx` | `/api/storefront-scripts` GET+POST | **App Proxy** | Prebuilt `PerformanceScript.deferScript` (`application/javascript`). See **§10.2** + §10.6 |
| `api.themes.jsx` | `/api/themes` GET | admin | Theme list for Step 1 picker |
| `api.toggle-validate.jsx` | `/api/toggle-validate` POST | admin | Pre-flight embed + password before toggle ON |
| `webhooks.app.uninstalled.jsx` | `/webhooks/app/uninstalled` | webhook HMAC | Soft-delete store, log, best-effort metaobject + Session delete |
| `webhooks.app.scopes_update.jsx` | `/webhooks/app/scopes_update` | webhook | Session.scope + `Store.currentScope` + activity |
| `webhooks.compliance.jsx` | `/webhooks/compliance` | webhook | GDPR: data_request/redact no-op; `shop/redact` → `eraseShopData` |

### 5.1 Removed route files (keep for old grep — not in tree today)

These rows are **preserved from earlier PROJECT_FLOW versions** so searches
for filenames still land here. See **§28 Appendix A** for removal evidence.

| File | URL | Auth | Purpose |
|---|---|---|---|
| `api.audit.start.jsx` | `/api/audit/start` POST | admin | Manual re-audit (skips if already complete and not running) |
| `api.script.jsx` | `/api/script` GET | App Proxy | **Leftover.** Dummy JS bundle. Liquid in this repo does not call this |
| `api.step-3.jsx` | `/api/step-3` POST | admin | Returns `PREDEFINED_SCRIPTS` (empty array today) |
| `api.save-performance-scripts.jsx` | `/api/save-performance-scripts` POST | admin | Upserts `PerformanceScript` raw text. **Not used by the wired proxy** |

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
| Compiled storefront JS/CSS | **`PerformanceScript.deferScript`** (rebuild when inputs change) | `rebuildPerformanceScript` → `syncScriptMetafield` | Obfuscated once; proxy reads stored bytes (**§10.1**). *Older note below still describes the compile inputs, not per-request proxy compile.* |
| *(historical wording)* | *Generated on each proxy request* | *`generateDeferredScript`* | *Superseded for proxy path — kept so prior readers recognize the phrase; see §28 Appendix A* |

`syncConfigToDatabase` **mirrors flags** into Postgres on dashboard load.
On **update** it deliberately does **not** write `auditComplete` or the
three audit arrays, so a routine load cannot clobber a finished audit with
empty metaobject lists.

Loader overlay: if DB arrays are non-empty they **win** over the
metaobject copy. Toggles and preserved snapshots always come from DB.

---


### 6.1 Sync mechanics (Postgres ↔ metaobject) — supplement to §6

| Function | File | Reads | Writes | Tie-break |
|---|---|---|---|---|
| `ensureConfig` / `getConfig` / `updateConfig` | `metaobjects.ts` | Shopify metaobject | Metaobject fields | Metaobject wins for flags on successful Admin read |
| `syncConfigToDatabase` | `store-sync.server.ts` 299–385 | `SyncConfigInput` from loader | `StoreConfig` flags/toggles; **update omits** audit arrays + `auditComplete` (353–357) | DB arrays/toggles win over empty metaobject mirror |
| `saveAuditReport` | `store-sync-audit.server.ts` | Audit result | Arrays, `AuditLog`, template buckets | Audit run overwrites lists unless field toggled OFF → preserved |
| `updateAuditArrays` / `updateAuditFieldToggle` | `store-sync.server.ts` 635+ | Merchant edits | DB only | DB authoritative |
| `safeSyncConfig` | `app/routes/app._index.jsx` 96–104 | Inline wrapper after metaobject write | Calls `syncConfigToDatabase` | Live toggle intents (§17.3 — not the dead helper module) |
| `rebuildPerformanceScript` | `performance-script.server.ts` 146+ | `StoreConfig` + optional `AuditLog` per-page | `PerformanceScript` + async metafield sync | Storefront bytes from DB inputs, not metaobject |

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
       → Prisma: Store + StoreConfig (one read)
       → FAST PATH if Store.isActive and no safety gate fires
            (use cached cachedAppEndpoint; isPasswordProtected is read as-is)
       → SLOW PATH (Promise.all, 3s timeout each) if:
            A. no Store / isActive=false
            B. lastSyncedAt older than 10 min
            C. cachedAppEndpoint ≠ current SHOPIFY_APP_URL/audit-submit
            D. ?refresh=1
            Then: ShopDetails + upsert, ensureConfig+endpoint, embed check.
            Cache cachedAppEndpoint on StoreConfig.
       → BACKGROUND (never awaited): refreshPasswordProtection() when
            isPasswordProtected is NULL or the slow path ran — Chromium
            redirect probe of the live URL + Shopify's setting; only a
            definite true/false is stored (NULL = not determined)
       → overlay DB arrays/toggles/password/custom URLs
  → Browser receives:
       { config, auditStatus, embedEnabled, embedActivateUrl,
         passwordProtected: true | false | null }
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
| Fast path vs Shopify | `app/routes/app._index.jsx` | Active Store + fresh `lastSyncedAt` + matching `cachedAppEndpoint` → paint from DB. Else `Promise.all` (shop, config, embed, password) | Do not skip Shopify on first install / reinstall / tunnel URL change |
| Parallel loader | `app/routes/app._index.jsx` | Slow path: `Promise.all([shop sync, ensureConfig+endpoint, isAppEmbedEnabled])`; password check runs in the background | Do not `await` A then B then C again; do not await the password check |
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
URLs, four arrays + enabled/preserved, `firstUserDelayMs`,
`everyTimeDelayMs`, `isPasswordProtected`, `cachedAppEndpoint`.

### 7.6 After Promise.all

1. `mergedConfig` = Shopify config **or** DB **or** `DEFAULT_CONFIG`.
2. `safeSyncConfig` only if Shopify read succeeded.
3. `auditStatus` from DB (`progress = round(pageIndex/totalPages*100)`).
4. First-install `StoreActivity` if `isNewStore`.
5. Overlay non-empty DB defer/hide; static defaults fall back to
   `["wpm","gtm"]` if DB empty.
6. Return `{ config: finalConfig, auditStatus, embedEnabled, embedActivateUrl }`.

`finalConfig` fields the React wizard uses:

```
appEnabled, script1/2/3Enabled, scriptTitles, debugMode,
auditDeferArray, auditHideSelectors, staticDeferDefaults, firstUserDelayScripts,
auditDeferArrayEnabled, auditHideSelectorsEnabled, staticDeferDefaultsEnabled,
firstUserDelayScriptsEnabled,
auditDeferArrayPreserved, auditHideSelectorsPreserved, staticDeferDefaultsPreserved,
firstUserDelayScriptsPreserved, firstUserDelayMs, everyTimeDelayMs,
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
- Password card is **hidden by default and shown when protection is
  confirmed**. Shopify never returns the password
  (`onlineStore.passwordProtection.enabled` is a boolean only), so
  `app/lib/password-protection.server.ts` combines two signals: a
  Playwright `goto(..., { waitUntil: "commit" })` redirect probe of the
  store's live URL (final path `/password` = protected; ~0.5-0.9 s
  measured, 10 s cap, fetch fallback if Chromium can't launch) and the
  Admin API setting (GraphQL `errors`/timeout = unknown, never false).
  Result is tri-state on `StoreConfig.isPasswordProtected`
  (`true` / `false` / `NULL` = not determined). The client polls
  `/api/password-status` (`usePasswordStatus`, ~12 s) while NULL and shows
  the card on `protected`: required field, master switch blocked until
  saved (`intent: "save-storefront-password"`, DB only).
  Safety nets while the card is hidden: `toggle-validate` / `toggle-app`
  use the stored answer or a live check; the audit stops with
  `auditError = PASSWORD_REQUIRED | PASSWORD_INCORRECT` (`AuditBlockedError`)
  and Step 1 shows the card + message. Saving a password after such a
  failure restarts the audit (`auditRestarted`).
- Custom PLP/PDP: `intent: "save-custom-page-urls"`. DB only. Empty
  string → `null` (audit then auto-discovers).
- Progress UI: assumes 30s/page, default 3 pages. Bar caps at 99% until
  poll says complete. Failed shows `auditStatus.error`.

### 8.2 Toggle-ON server path (`intent: "toggle-app"`, true) — historical steps


1. Re-check `isAppEmbedEnabled`. If `false`, return
   `{ ok:false, error:"extension_required", embedEnabled:false, … }`
   and do **not** enable.
2. `updateConfig`: `appEnabled=true`, all three `scriptNEnabled=true`.
3. `resetAudit` — metaobject arrays `[]`, `audit_complete=false`.
4. `startHiddenAudit(admin, session.shop)` — sets `auditRunning=true`,
   returns immediately; Playwright runs in a floating async IIFE.
5. `safeSyncConfig` + `logActivity("config_changed")`.
6. Return `{ ok:true, config, auditRunning:true }`.

### 8.3 Toggle-OFF — historical steps


`updateConfig({ appEnabled:false })` — does **not** clear individual
script flags. Then `resetAudit`, then DB upsert clearing
`auditRunning/Complete/Failed`, `lastAuditAt`, both audit arrays.
Activity logged.

### 8.4 Step 2 — `Step2Configure.jsx` + nested `Step3Titles.jsx`


`PREDEFINED_SCRIPTS` is `[]`, so **zero script-slot rows render**.
`script1/2/3Enabled` still exist on the metaobject and in `toggle-script`.

`Step3Titles` — four independent JSON-array cards:

| Label | DB column | Storefront use |
|---|---|---|
| Defer Heavy Scripts | `auditDeferArray` | `generateDeferredScript` arg 1 (`var P`) — hold until interaction |
| Hide Lastfold Classes | `auditHideSelectors` | `buildHiddenCss` + inject `<style id="pp-hide-lastfold">` — see §10.3 |
| Delay Scripts for First User | `firstUserDelayScripts` + `firstUserDelayMs` | First visit only (`localStorage.__wpmDelayDone`). Default 12s or first interaction |
| Delay Scripts | `staticDeferDefaults` + `everyTimeDelayMs` | Every page load, timer only. Default 6s |

Each box:

- Toggle `intent: "toggle-audit-field"` (`updateAuditFieldToggle`).
  OFF: snapshot active → preserved, active = `[]`.
  ON: restore preserved (or keep active if preserved empty).
  Data is never deleted.
- Dirty valid JSON (or delay seconds) shows a compact **Save** beside
  the toggle. Invalid JSON replaces the hint with “Invalid JSON” and
  tints the card. Save `intent: "save-audit-arrays"` — **DB only.**
  If that field’s toggle is OFF, write `[]`.

Dead intents still in the action (no current UI caller):
`save-titles`, `save-audit-defer`, `save-audit-hide` (these **do** write
the metaobject).

### 8.5 Dashboard `action` intents (complete)


| `intent` | Form fields | Writes | Used by |
|---|---|---|---|
| `toggle-app` | `appEnabled` true/false | Metaobject flags; ON starts audit; OFF `resetAudit` + clears DB audit arrays | `Step1Activate` |
| `toggle-script` | `scriptIndex` 0–2, `enabled` | Metaobject `scriptNEnabled` + DB sync | `Step2Configure` (no rows while `PREDEFINED_SCRIPTS` is `[]`) |
| `toggle-audit-field` | `field`, `enabled` | DB only via `updateAuditFieldToggle` | `Step3Titles` |
| `save-audit-arrays` | any of the 4 JSON arrays and/or `firstUserDelayMs` / `everyTimeDelayMs` | DB only via `updateAuditArrays`; OFF field forced to `[]` | `Step3Titles` Save |
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

### 8.6 Toggle paths as implemented today (`app._index.jsx`)


The numbered steps in **§8.2–8.3 above** describe an earlier automatic-audit shape. The **current** server code:

- **`toggle-app` ON:** embed + password guards; enables scripts; `rebuildPerformanceScript`; does **not** call `resetAudit` on every ON. **OFF→ON only:** `startAuditForStore` (fire-and-forget). Re-enabling when already ON does not spawn another run (`app._index.jsx` ~685–698).
- **`toggle-app` OFF:** master switch only; audit arrays and lifecycle are **not** wiped (`app._index.jsx` ~665–672).
- **`start-audit`:** explicit re-run when app on, embed on, not already `auditRunning` (~716–784).
- **`POST /api/toggle-validate`:** client pre-check (`api.toggle-validate.jsx`).

Additional intents: `select-theme`, `script-token-action` (scoped defer/delay edits in Step 3).

### 8.7 Dashboard server modules (`app/lib/dashboard-*.server.js`)

Reachability (2026-10-19 import graph): **`app/routes/app._index.jsx` imports zero `dashboard-*` modules.** Only `dashboard-report-loader.server.js` is live (via `api.dashboard-report.jsx`). Everything else in this table is **unreachable** or **transitively dead** — see §17.3.

| Module | Exports / entry | Reachability | Fast vs slow path (if ever wired) |
|---|---|---|---|
| `dashboard-loader.server.js` | `loader` (`33`) | **Unreachable** — no importers | Would call `reconcileScriptMetafield`, `maybeSweepStaleAuditStateForShop`, `healStoreIfReinstalled` |
| `dashboard-helpers.server.js` | `STORE_CONFIG_SELECT`, `configFromDbRow`, `safeUpdateConfig`, `safeSyncConfig`, … (`8–199`) | **Transitively dead** — only imported by dead dashboard modules | N/A today |
| `dashboard-actions.server.js` | `action` router (`21`) | **Unreachable** | Intent router |
| `dashboard-actions-audit.server.js` | `handleToggleApp`, `handleStopAudit`, `handleStartAudit` | **Transitively dead** | Slow (audit start) |
| `dashboard-actions-theme.server.js` | `handleSelectTheme`, `handleRetryHeadInject` | **Transitively dead** | Slow (theme / inject) |
| `dashboard-actions-step3.server.js` | `handleToggleAuditField`, `handleSaveAuditArrays`, `handleScriptTokenAction` | **Transitively dead** | DB writes |
| `dashboard-actions-settings.server.js` | `handleSaveStorefrontPassword`, `handleSaveCustomPageUrls` | **Transitively dead** | DB + optional audit restart |
| `dashboard-report-loader.server.js` | `loadDashboardAuditReportSummary` (`5`) | **Live** — `api.dashboard-report.jsx` `6–8` | On-demand report fetch |

### 8.8 Audit report UI (Step 3)


- `Step3AuditResults.jsx` — lazy `useFetcher` → `/api/dashboard-report`.
- `AuditReportPanel.jsx` — sortable inventory; statuses from `audit-classified-inventory.ts`.
- `Step3Titles.jsx`, `PpPillButton.jsx`, `step1/Step1AuditRunning.jsx` (stop UI **not wired** to any route yet).

### 8.8.1 `AuditReportPanel.jsx` — symbol table

| Name | File:line | Purpose |
|---|---|---|
| `formatScriptSize` | `AuditReportPanel.jsx:28` | Human-readable byte size for script rows |
| `scriptActionSelectValue` | `36` | Maps row + template lists → defer/hide select value |
| `compareScriptRows` | `44` | Sort comparator for script table columns |
| `scoreColor` / `metricColor` / `barPercent` | `112–131` | Lighthouse-style metric coloring |
| `useInView` | `139` | Intersection observer for bar animations |
| `AnimatedBar` / `CircularScoreGauge` / `MetricRow` | `157–249` | Scan summary visuals |
| `OverviewLighthouse` | `292` | PSI overview block — **defined, not rendered** (lint waiver) |
| `AuditReportPanel` (default) | `358` | Sortable inventory; `useFetcher` for `script-token-action` |
| `SCRIPT_TABLE_COLUMNS` | `~70` | Column ids for sortable script table |

Data: `summary` from `/api/dashboard-report`; statuses align with `buildScriptInventoryFromClassified` (§9.5.5).

### 8.9 `startHiddenAudit` entry (see also `audit-runner.server.ts`)


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



### 8.10 Complete dashboard `action` intent table (`app._index.jsx`)

| Intent | Validates | Writes | `StoreActivity` | Client return | UI source |
|---|---|---|---|---|---|
| `toggle-app` | Embed, password if protected (`575–648`) | Metaobject via `safeUpdateConfig`; `rebuildPerformanceScript` (`677`) | `config_changed` App on/off (`678–683`) | `{ ok, config, auditStarted }` | Step 1 switch |
| `start-audit` | `appEnabled`, not running, embed (`716–760`) | `startAuditForStore` | `config_changed` Audit started manually (`768–773`) | `{ ok, auditStarted }` | Step 1 Run audit |
| `select-theme` | Theme in list (`787–798`) | `selectedThemeId` upsert | — | `{ ok, themeId, embedEnabled }` | Step 1 theme picker |
| `toggle-script` | Index 0–2 | Metaobject script N | — | `{ ok, config }` | Step 2 (no rows today) |
| `toggle-audit-field` | Allowed field name | `updateAuditFieldToggle` | — | `{ ok, field, enabled }` | Step 3 toggles |
| `save-audit-arrays` | JSON arrays / delay ms | `updateAuditArrays` | — | `{ ok, …patch }` | Step 3 Save |
| `save-storefront-password` | Non-empty when required | `storefrontPassword` | May restart audit on password errors | `{ ok, auditRestarted? }` | Step 1 password card |
| `save-custom-page-urls` | URL normalize | PLP/PDP + `customPageUrls` | — | `{ ok, warnings }` | Step 1 URLs |
| `script-token-action` | `token`, `action` ∈ defer/delay_first/delay_every/protected (`1115–1165`) | `updateAuditArrays` via `buildArrayPatchForTokenAction` | `config_changed` with token metadata | `{ ok, token, action, …patch }` | `AuditReportPanel` / Step 3 |

`POST /api/toggle-validate` (`api.toggle-validate.jsx` 31+) is **not** an `intent` on `app._index` — Step 1 calls it via `validationFetcher` (`Step1Activate.jsx` 327).

---

### 8.11 Step 1 / Step 3 UI state (`Step1Activate.jsx`, `Step3Titles.jsx`)

**Step 1 fetchers** (`Step1Activate.jsx` 44–49): `fetcher` toggle-app; `pwFetcher` password; `urlFetcher` custom URLs; `validationFetcher` → `/api/toggle-validate`; `themesFetcher` → `/api/themes`; `selectFetcher` select-theme.

**Audit polling:** Parent `app._index.jsx` polls `/api/audit/status` every 1s when `expectingAudit` or `auditStatus.running` (see §7.8). `usePasswordStatus` polls `/api/password-status` while tri-state NULL.

**Step 1 states (merchant-visible):** app off + embed off → extension redirect; app off + embed on → can validate toggle; app on + audit running → progress; audit failed → error string from `auditStatus.error`; password card when `passwordProtected === true`.

**Step 3:** `Step3Titles.jsx` — per-scope JSON editors; `script-token-action` from report table; toggles use `toggle-audit-field`.

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

### 9.5 Engine decomposition supplement (2026-10-19)

### 9.5.1 Module map

| Symbol | File | Role |
|---|---|---|
| `startAuditForStore` | `audit-runner.server.ts` | Entry: DB progress, slot semaphore, calls `runHiddenAudit` |
| `discoverPages`, `runHiddenAudit` | `audit.server.ts` | **Live** scan implementation (largest module ~2261 lines) |
| `runHiddenAudit` (copy) | §17.3 duplicate | **Unreachable** — drift risk; live code in `audit.server.ts` |
| `withBrowser`, types | `audit-core.server.ts` | Shared browser lifecycle |
| `measurePage`, passes | `audit-run-page-measure.server.ts` | Per-page measure + interaction |
| Timings | `audit-run-page-timing.ts` | Exported constants (also duplicated in `audit.server.ts`) |
| `buildScriptInventory` | `audit-inventory.server.ts` | Network inventory assembly |
| `buildScriptInventoryFromClassified` | `audit-classified-inventory.ts` | deferred/protected/never/noise/self/candidate |
| `saveAuditReport` | `store-sync-audit.server.ts` | Persist arrays + template buckets |
| Popup selectors | `popup-audit.js` | MutationObserver cap 30, cross-page veto |
| Fold policy | `audit-fold-policy.server.ts` | Above-fold hide safety |
| Gate impact | `audit-gate-impact.server.ts` | Home defer impact measurement |
| Metrics throttle | `audit-metrics.server.ts` | Lab vitals (`AUDIT_LAB_THROTTLE`) |

### 9.5.2 Phases inside `runHiddenAudit` (`audit.server.ts`)

1. **Discover** URLs — home, PLP, PDP, up to `MAX_EXTRA_PAGES = 8` extras (`audit.server.ts` 742).
2. **Three passes** — `AUDIT_REPEAT_PASSES = 3` (742–744): pass 1 full measure; later passes harvest tokens with lighter work.
3. **Parallel pages** — `Promise.all` over URL list (see `docs/server-load-reduce.md` §3 for RAM implications).
4. **Settle** — `SETTLE_MIN_MS = 5000`, probes `SETTLE_PROBE_GAP_MS = 900`, `SETTLE_STABLE_CHECKS = 2`, cap `SETTLE_SAFETY_NET_MS = 40000` (`audit-run-page-timing.ts`).
5. **Fold band** — `FOLD_HEIGHT_PX = 1100` — hide candidates must not overlap fold (`audit-fold-policy.server.ts`).
6. **Classification** — tokens → defer vs never vs noise vs self vs protected vs candidate (`audit-classified-inventory.ts`).

### 9.5.3 Concurrency and queue (important)

| Mechanism | Status |
|---|---|
| `audit-runner.server.ts` `MAX_CONCURRENT_AUDITS = 1` | **Live** — in-process semaphore |
| `audit-queue.server.ts` `enqueueAuditJob` / `drainAuditQueue` | **Implemented, not called** from `startAuditForStore` (used by `scripts/audit-soak.ts`) |
| `AuditJob` + heartbeat `lockedAt` | Wired in queue/watchdog modules; runner does not yet `touchAuditJobHeartbeat` |
| `audit-watchdog.server.ts` | `maybeSweepStaleAuditStateForShop` — **only caller is §17.3 dead loader**; live `app._index.jsx` loader does not sweep |
| `AUDIT_STOPPED_BY_USER` | `audit-lifecycle.ts` 11 — `stopAuditForShop` in watchdog; UI `Step1AuditRunning` **not mounted**; `stop-audit` intent only in §17.3 dead action router |

### 9.5.4 Password / preview

- Store password: `appendPasswordBypass` / audit navigation (`audit.server.ts`).
- PSI on password stores: `psiPreviewBypassParams` (`_bt`, `key`, `preview_theme_id`) from theme share link (`psi-preview-url.server.ts`).

---


### 9.6 `audit.server.ts` — exports and `runHiddenAudit` walkthrough

| Export | Line (approx) | Role |
|---|---|---|
| `DiscoveredPages`, `HiddenAuditResult`, `PageFunnel`, `FoldAssertion` | 40–105 | Report shapes |
| `AuditBlockedError`, `AuditBlockCode` | 123–125 | Password gate errors |
| `withBrowser` | 194 | Shared Chromium lifecycle |
| `appendPreviewParams`, `describePages`, `pickPagesFromDiscovery` | 233–312 | URL helpers |
| `isPasswordPageHtml`, `isPasswordPage`, `unlockPasswordPage`, `returnToRequestedUrl` | 367–438 | Password form handling |
| `discoverPages` | 557 | Home/PLP/PDP/extras discovery |
| `AuditPhase`, `AuditProgress` | 678–680 | Progress callbacks |
| `runHiddenAudit` | 1859 | **Live scan orchestrator** |

**`runHiddenAudit` phases** (`audit.server.ts` 1875–1974+):

1. Build URL list (home, plp, pdp, extras) — 1878–1880.
2. `withBrowser` → loop `AUDIT_REPEAT_PASSES` (3) — 1896.
3. Per pass: `Promise.allSettled` → `measurePage(browser, url, password, harvestOnly)` — 1898–1899 (`audit-run-page-measure.server.ts`).
4. Progress via `onProgress` — 1917–1920.
5. Password block → `AuditBlockedError` — 1938–1941.
6. Merge tokens across passes into sets; fold/coverage/nevere/noise classification — 1949+.

**Not extracted (still in `audit.server.ts`)**: `measurePage` import path, pass loop, and set merging stayed monolithic; the §17.3 duplicate scan file is **unreachable**. Decomposition lives in `audit-run-page-measure.server.ts`, `audit-core.server.ts`, `audit-inventory.server.ts` — called from live `runHiddenAudit`.

### 9.5.5 `audit-classified-inventory.ts` — symbol table

| Name | File:line | Purpose |
|---|---|---|
| `ClassifiedInventoryEntry` | `audit-classified-inventory.ts:6` | One inventory row: token, status, reasons, pages, optional domain |
| `buildScriptInventoryFromClassified` | `31` | Maps audit report sets → `byToken` + `totals` for UI / `topScripts` |
| `domainFromToken` | `14` | Heuristic third-party domain from bare hostname token |
| `tokenSeenOnPage` | `21` | Prefix/substring match for per-page defer lists |

Statuses: `deferred`, `protected`, `never`, `noise`, `self`, `candidate` (`4`). No runtime imports besides tests and report builders.

---

## 10. Storefront delivery (wired path in this codebase)

### 10.1 Primary — inline metafield + theme embed

```mermaid
flowchart LR
  A[rebuildPerformanceScript] --> B[(PerformanceScript.deferScript)]
  B --> C[syncScriptMetafield / script-inline.js]
  C --> D[Shop metafields $app:pagepulse script..script_6]
  D --> E[performance-loader.liquid compliance_head]
  E --> F[pagepulse-inline.liquid json concat + eval]
```

| Piece | Location | Behavior |
|---|---|---|
| Namespace | `script-inline.js` `METAFIELD_NAMESPACE = "$app:pagepulse"` | App-reserved shop metafields |
| Chunking | `MAX_CHUNKS = 6`, `CHUNK_CHARS = 60_000` | `script_parts` integer + `script`…`script_6` |
| Liquid | `snippets/pagepulse-inline.liquid` | `{{ value \| json }}` per chunk — **fixes HTML-escape breakage** for obfuscated JS |
| Embed target | `blocks/performance-loader.liquid` | `target: "compliance_head"` — earliest head slot |
| Double-run guard | `unless app.metafields.pagepulse.theme_head_active` | Skips embed when theme.liquid injection active |
| Missing metafield | — | **No `<script src>` fallback** — embed prints nothing (`script-inline.js` 7–8) |

`reconcileScriptMetafield` is implemented in `script-metafield.server.ts` (`183+`) with a 60s per-shop cooldown, but **only the §17.3 dead loader** calls it on load. Live `app._index.jsx` heals metafields via `rebuildPerformanceScript` → `syncScriptMetafield` on toggle/save paths, not on every paint.

### 10.2 Secondary — App Proxy JavaScript

`GET /apps/performance-scripts` → `api.storefront-scripts.jsx`:

- Auth: `authenticate.public.appProxy` + `verifyAppProxyShop` (`proxy-shop.js`).
- Returns **prebuilt** `deferScript` with `ETag: scriptHash`, `Cache-Control: public, max-age=300, stale-while-revalidate=86400`.
- If row empty, one-shot `rebuildPerformanceScript` then serve.
- App off → body `/* pp:off */`.

Used when theme uses **head injection** (`theme-head-inject.server.ts`) to insert a blocking `<script src="/apps/performance-scripts?...">` — see `theme_head_active` metafield.

### 10.3 Theme.liquid head injection (optional)

`attemptThemeHeadInject` (`theme-head-inject-status.server.ts`) patches `layout/theme.liquid` via `themeFilesUpsert` when `PAGEPULSE_THEME_HEAD_INJECT !== "false"`. Status stored on `StoreConfig.themeHeadInjectStatus`. Idempotent patch helpers in `theme-head-patch.js` / `theme-head-inject-utils.js`.

### 10.3.1 `theme-head-inject.server.ts` — symbol table & status machine

| Name | File:line | Purpose |
|---|---|---|
| `ensureThemeHeadInlineScript` | `theme-head-inject.server.ts:196` | Read/patch `layout/theme.liquid` + snippet; `themeFilesUpsert`; set `theme_head_active` metafield |
| `clearThemeHeadDelivery` | `247` | Clears `theme_head_active` after uninstall cleanup |
| `attemptThemeHeadInject` | `theme-head-inject-status.server.ts:84` | Skip if `shouldSkipThemeHeadInject`; else inject + persist status on `StoreConfig` |
| `shouldSkipThemeHeadInject` | `theme-head-inject-status.server.ts:34` | Skip when already `injected` or in `exempt_denied` cooldown (7 days, `14`) |
| `isThemeFilesExemptDenied` | `theme-head-inject-utils.js:46` | Detects Shopify `themeFiles` exempt-denied errors → `EXEMPT_DENIED` status |
| `THEME_HEAD_INJECT_STATUS` | `theme-head-inject-utils.js:54` | `injected`, `skipped`, `error`, `exempt_denied` |

**Flow:** `syncScriptMetafield` success path calls `attemptThemeHeadInject` (`script-metafield.server.ts:140–142`). Failed inject with exempt-denied → `exempt_denied` on config; re-attempt blocked until cooldown unless `force`.

### 10.4 Build pipeline

`rebuildPerformanceScript` (`performance-script.server.ts`):

1. Read `StoreConfig` lists + per-page audit data from latest `AuditLog.audit_data` when present.
2. `generateDeferredScript` + `buildHiddenCss` (`script-generator.js`).
3. Obfuscate in `generateDeferredScript`; store `scriptHash` on the row (`performance-script.server.ts` 197–207). Prisma also defines `inputsHash` on `PerformanceScript` but **no app/lib code reads it yet** (2026-10-19).
4. `syncScriptMetafield` writes Shopify metafields (serialized per-shop chain in `script-metafield.server.ts`).

Operator backfill: `scripts/backfill-script-metafield.ts`.

### 10.4.1 `script-metafield.server.ts` — symbol table

| Name | File:line | Purpose |
|---|---|---|
| `syncScriptMetafield` | `script-metafield.server.ts:75` | Per-shop serialized chain; reads **current** `PerformanceScript` row; `planMetafieldSync` → write/clear Shopify metafields |
| `clearScriptMetafield` | `162` | Explicit metafield delete |
| `reconcileScriptMetafield` | `183` | Cooldown-gated heal (`RECONCILE_COOLDOWN_MS` 60s); compares DB hash vs `metafieldHash` via `planMetafieldSync` |
| `planMetafieldSync` | `script-inline.js:137` | **Skip write** when `scriptHash === metafieldHash` (noop); not `inputsHash` on `PerformanceScript` |

**Rebuild skip:** `rebuildPerformanceScript` always regenerates (`performance-script.server.ts:146–208`). Metafield **sync** skips when hashes match (`planMetafieldSync` noop). Prisma `inputsHash` column has **no** `app/lib` reader (2026-10-19).

---

> **Diagram below (JSON `fetch` path):** retained from the prior doc. The theme embed block in this repo **does not** use that fetch; it renders inline metafields (**§10.1**). The proxy path remains for `application/javascript` + theme head inject.

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

### 10.5 Liquid (`extensions/script-injector/blocks/performance-loader.liquid`)

- Schema name: **Performance Script Loader**, `target: compliance_head` (earliest app-embed slot in `<head>`; older docs said `head`). No settings.
- No Liquid App Proxy signature helper — Shopify injects query params on
  the fetch URL when the request is same-origin on the shop domain.
- Password-protected storefronts: anonymous `curl` without the password
  cookie gets Shopify’s password **HTML**, which looks like a 500. Unlock
  the storefront (or send `_password` + digest) before judging the proxy.

### 10.6 `api.storefront-scripts.jsx`


> **2026-10-19 behavior:** This route returns **prebuilt** `PerformanceScript.deferScript` as `application/javascript` with ETag (`api.storefront-scripts.jsx` lines 13–21, 70–77). The bullets below describe an **older JSON + compile-on-request** contract; kept for context — do not implement both.

- `authenticate.public.appProxy(request)`.
- Shop = `auth.session.shop` or `?shop=`.
- Load `Store` + latest `StoreConfig`.
- If `!store.isActive` or `!config.appEnabled` →
  `{ success:true, data:{ auditScript:"", hiddenCss:"" } }` (no-op).
- Else, respect per-field enabled flags (OFF → `[]`):
  - `auditScript = generateDeferredScript(deferArray, staticDefer, { firstUserDelayScripts, firstUserDelayMs, everyTimeDelayMs, hideSelectors })`
  - `hiddenCss = buildHiddenCss(hideSelectors)` (same CSS the generated JS also injects)
- Headers: `Content-Type: application/json`,
  `Cache-Control: private, no-store`.
- `action` handles POST + OPTIONS (204). Loader and action share
  `handleProxy`. Errors return `{ success:false }` **200-ish JSON**, not
  a thrown 500 (so Liquid’s `r.ok` path still parses).

Typical compiled `auditScript` is ~200–280KB after obfuscation.

### 10.7 Hide CSS

`buildHiddenCss` in `script-generator.js`:

```
html:not(.interacted) :is({selectors}){display:none!important}
```

Liquid injects it as `<style id="pp-hide-lastfold">` as soon as the
proxy JSON returns. The generated script also inserts that tag into
`document.head` if the id is missing. First interaction adds
`interacted` on `<html>` (§11.1), which lifts the hide.

### 10.8 Present in the repo but not wired to the destore storefront

- `api.script.jsx` — dummy JS, two no-op scripts + empty style.
- `api.save-performance-scripts.jsx` — writes `PerformanceScript` rows
  the loader never reads.
- `app/lib/scripts.ts` dummies + empty `PREDEFINED_SCRIPTS`.
- `app/lib/shopify.js` old editor URL.

---

## 11. `generateDeferredScript(auditArray, deferArray, options)`

File: `app/lib/script-generator.js`. Server-only. Output is obfuscated
(`compact`, control-flow flattening, dead-code, RC4+base64 string array,
`disableConsoleOutput`, hex identifiers, `selfDefending: false` so
`new Function()` in Liquid still runs).

`options`: `firstUserDelayScripts`, `firstUserDelayMs` (default 12000),
`everyTimeDelayMs` (default 6000), `hideSelectors`.

Three **independent** script gates (a URL matching more than one is
held by each; release is whichever fires) plus the hide-CSS inject:

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

### 11.3 First-user delay (once per browser)

Merchant “Delay Scripts for First User” (`firstUserDelayScripts`,
default `wpm`, `gtm`). Hold for `firstUserDelayMs` (default 12s)
**or** first interaction, whichever first.
`localStorage.__wpmDelayDone=1` so later page views skip this gate.
Intercepts `HTMLScriptElement` `src` setter.

### 11.4 Every-load delay (`var EVERY_TIME_DELAY_SCRIPTS = deferArray`)

Merchant “Delay Scripts” (`staticDeferDefaults`, default
`wpm`, `gtm`). Timer is `everyTimeDelayMs` (default 6s), **every
page load**, no interaction release. Marks `data-et-deferred`.

`parseToArray` exists for string/CSV input; `api.storefront-scripts.jsx`
already passes string[].

---



### 11.6 Template scopes (Global / Home / Collection / Product)

 (`template-script-config.ts`)

| Scope | Defer column | Hide column | First-user delay | Every-visit delay |
|---|---|---|---|---|
| global | `auditDeferGlobal` | `auditHideGlobal` | `firstUserDelayScriptsGlobal` | `staticDeferDefaultsGlobal` |
| home | `auditDeferHome` | … | … | … |
| collection | `auditDeferCollection` | … | … | … |
| product | `auditDeferProduct` | … | … | … |

**Union fallback:** legacy columns `auditDeferArray`, `auditHideSelectors`, `staticDeferDefaults`, `firstUserDelayScripts` — used when scoped buckets empty (`readBucketsFromRow` legacyColumn parameter).

**UI:** `Step3Titles.jsx` + `script-token-action` intent applies per-scope keep/remove on a single token (`app._index.jsx` `1115+`; parallel handler exists only in §17.3 dead modules).

---


### 11.7 Storefront build pipeline (`script-generator.js`, `performance-script.server.ts`, `script-inline.js`)

| Step | Where | Detail |
|---|---|---|
| Inputs | `performance-script.server.ts` 166–192 | Respects `*Enabled` toggles; optional per-page data from `AuditLog` |
| Generate + obfuscate | `script-generator.js` 615–632 | `compact`, CFF 0.3, `stringArray` base64, `seed` from shop (`script-generator.js` 89–99), `selfDefending: false` for `eval` inline |
| Persist | `performance-script.server.ts` 204–208 | `scriptHash` = sha256 of deferScript |
| Metafield plan | `script-inline.js` `planMetafieldSync` | Max 6 × 60k chars; unsafe scripts not inlined |
| Shopify write | `script-metafield.server.ts` | Per-shop serialized chain; 10s timeout + one retry |

**Rebuild skip:** There is **no** `inputsHash` comparison in `app/lib` today — every `rebuildPerformanceScript` call regenerates and upserts (146–208).

### 11.7.1 Build pipeline — symbol tables

**`script-generator.js`**

| Name | File:line | Purpose |
|---|---|---|
| `parseToArray` | `script-generator.js:3` | Coerce JSON/string list inputs |
| `buildHiddenCss` | `24` | `html:not(.interacted) :is(...)` hide stylesheet |
| `generateDeferredScript` | `79` | Full storefront IIFE; obfuscation block ~615–632 (`compact`, CFF, string array, shop `seed`) |

**`performance-script.server.ts`**

| Name | File:line | Purpose |
|---|---|---|
| `readStringArray` | `performance-script.server.ts:123` | Prisma Json → `string[]` |
| `rebuildPerformanceScript` | `146` | Load config + per-page audit data → generate → upsert row → `void syncScriptMetafield` |

---

## 12. Metaobject helpers (`app/lib/metaobjects.ts`)

`CONFIG_TYPE = "$app:script_injector_config"` — the `$app:` prefix is
required or Admin GraphQL finds nothing.

| Export | Behavior |
|---|---|
| `defaultAppConfig()` | All flags false; static defaults `wpm`, `gtm` |
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
| `DEFAULT_STATIC_DEFER` | `saveAuditReport` create path | `["wpm","gtm"]` |
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

### 12.2 Two sources of truth — `metaobjects.ts` + `store-sync.server.ts`

**Read path (dashboard loader):** Admin GraphQL metaobject via `getConfig` / `ensureConfig` (`metaobjects.ts:226–298`) for wizard flags; **Postgres wins** for non-empty audit arrays and toggles when loader merges (`§6` overlay). Metaobject is the Shopify-native mirror for app-enabled flags and script slot toggles.

**Write path (toggle ON/OFF):** `updateConfig` → metaobject, then `safeSyncConfig` in `app._index.jsx` → `syncConfigToDatabase` (`store-sync.server.ts:299`). Update branch **refuses** to copy `auditComplete` or the three audit arrays from metaobject (`353–357`) so empty metaobject data cannot clobber a finished audit.

| Name | File:line | Purpose |
|---|---|---|
| `getConfig` | `metaobjects.ts:226` | Read metaobject → `AppConfig` |
| `updateConfig` | `236` | Partial metaobject field write |
| `ensureConfig` | `298` | Get or create metaobject row |
| `resetAudit` | `387` | Clear arrays on metaobject + `auditComplete=false` |
| `syncConfigToDatabase` | `store-sync.server.ts:299` | Upsert `StoreConfig` flags; audit arrays **create-only** on first row |
| `saveAuditReport` | `store-sync-audit.server.ts` | Audit engine → DB arrays + `AuditLog` (authoritative for defer/hide lists) |
| `updateAuditArrays` | `store-sync.server.ts:635` | Merchant Step 3 saves — DB only |

**Tie-break:** Finished audit data lives in Postgres (`saveAuditReport` / `updateAuditArrays`). Metaobject lists are not trusted on routine sync. Storefront bytes come from `rebuildPerformanceScript` reading **Postgres** `StoreConfig`, not metaobject JSON.

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

| `20260922085053_add_first_user_delay_scripts` | ADD first-user delay scripts + ms |
| `20260922150000_add_password_protected_and_cached_endpoint` | ADD `isPasswordProtected`, `cachedAppEndpoint` |
| `20260924120000_add_selected_theme_and_audit_pages` | ADD `selectedThemeId`, `auditPages` |
| `20260924130000_add_performance_script_hash` | ADD `scriptHash` on `performance_scripts` |
| `20260924140000_add_audit_phase` | ADD `auditPhase` |
| `20260924150000_default_delay_scripts_wpm_gtm` | Default wpm/gtm delay tokens |
| `20260924160000_backfill_delay_scripts_wpm_gtm` | Data backfill |
| `20260924170000_password_protected_nullable` | Tri-state password flag |
| `20260930120000_admin_session_version` | ADD `AdminUser.sessionVersion` |
| `20260930150000_custom_page_urls` | ADD `customPageUrls` JSON |
| `20261007120000_add_metafield_sync_columns` | ADD `metafieldHash`, `metafieldSyncedAt` |
| `20261009140000_add_theme_head_inject_status` | Theme head inject status columns |
| `20261012120000_add_psi_field_columns` | PSI field vitals + backoff |
| `20261012140000_audit_job_and_psi_snapshot` | `AuditJob`, `PsiSnapshot`, `activeAuditJobId` |
| `20261013153000_psi_preview_bypass_params` | `psiPreviewBypassParams` |
| `20261013180000_template_script_columns` | Template-scoped defer/hide/delay columns |
| `20261014120000_audit_job_active_unique` | One active job per store (partial unique) |

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
5. `npx prisma generate && npx prisma migrate deploy` (25 migrations;
   see §14.2 (full table — 25 folders)).

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

If the developer already gave store + password in this chat, reuse
them. Do not invent a store.

If a previous `shopify app dev` is running, do **not** blindly reuse
it. Check the printed `trycloudflare.com` host still answers. If DNS
fails or storefront proxy is 500, kill that process and start a new
one.

When an agent starts Shopify CLI itself, prefix:

```bash
SHOPIFY_CLI_AGENT_INFO="n:cursor|v:none|p:none|m:<model>" \
SHOPIFY_CLI_AGENT_IDS="s:<conversation-id>" \
shopify ...
```

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

Known destore used while writing this (password `1`):

```bash
env -u PLAYWRIGHT_BROWSERS_PATH shopify app dev \
  --config pagepulse \
  --store rishabh-dev-store-mdqu0epm.myshopify.com \
  --store-password 1 \
  --skip-dependencies-installation
```

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

> **2026-10-19 correction (keep prior text below):** The theme embed uses
> **inline shop metafields** (`pagepulse-inline.liquid`, `compliance_head`) —
> see **§10.1**. The JSON `fetch` contract in the next paragraph describes an
> **older** integration shape; the live proxy returns **`application/javascript`**
> (`PerformanceScript.deferScript`), not `{ success, data: { auditScript } }`.

Theme embed `extensions/script-injector/blocks/performance-loader.liquid`
*(historical note)* does `fetch("/apps/performance-scripts")` and expects JSON:

```json
{ "success": true, "data": { "auditScript": "<js>", "hiddenCss": "<css>" } }
```

`app/routes/api.storefront-scripts.jsx` **must** compile from
`StoreConfig`:

- `auditDeferArray` / `staticDeferDefaults` / `auditHideSelectors`
- respect each field’s `*Enabled` toggle
- `generateDeferredScript(deferArray, staticDefer)` — both arguments
  are **string arrays**
- hide CSS from hide selectors (`html:not(.interacted) :is(…){display:none!important}`)

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

1. **`api.script.jsx` is not used** (file **removed from tree** 2026-10-19).
   The Liquid in older integration notes fetches
   `/apps/performance-scripts` → `api.storefront-scripts.jsx` (JSON shape —
   see §16.6). If `api.script.jsx` reappears, it is still not the wired path.
   Live delivery today: inline metafields (**§10.1**) + proxy JS (**§10.2** /
   §10.6).
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
12. **First-user delay (`wpm`, `gtm` by default, 12s)** is separate
    from merchant Delay Scripts (`wpm`, `gtm` by default, 6s every
    load). Both lists come from the DB; nothing is hardcoded in the
    generator.
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

### 17.1 Additional traps (2026-10-19 supplement)

| Item | Why |
|---|---|
| Dead dashboard + audit duplicate | Full inventory §17.3 — **1,855 lines**, not executed in production |
| `Step1AuditRunning.jsx` | Stop button UI **never imported** |
| `enqueueAuditJob` | Only `audit-soak.ts` — production uses direct `startAuditForStore` |
| Oct-16 doc routes (`api.script.jsx`, etc.) | **Deleted** |
| `PerformanceScript.auditScript` column | Legacy; report now in `AuditLog.audit_data` |
| `admin-panel` Prisma schema | Can drift — check comment in `admin-panel/prisma/schema.prisma` |
| Lint/typecheck | §17.4 |

**`/audit-submit`**: still written to metaobject `app_endpoint` — **no route** (planned storefront POST).

### 17.3 Dead and unwired code (import graph, 2026-10-19)

**Total:** **1,855** lines (`wc -l`) across eight files ≈ **9.7%** of `app/` source (`19,058` lines) and ≈ **13.4%** of `app/lib/` (`13,803` lines). These modules are maintained in-tree but **never imported** by live routes (except the dead chain below). **`npm test` passing does not execute them.**

| File | Lines (`wc -l`) | Imported by | Origin / verdict |
|---|---:|---|---|
| `app/lib/dashboard-loader.server.js` | 450 | **nothing** | Extracted loader refactor (`6a03bd2`, `a33dcfc`, 2026-10-14/15) — **wire** `app._index.jsx` to this module **or delete** and keep monolithic loader |
| `app/lib/dashboard-actions.server.js` | 50 | **nothing** | Same refactor — **wire** as `action` export **or delete** |
| `app/lib/dashboard-actions-audit.server.js` | 242 | dead `dashboard-actions.server.js` only | **delete** with cluster if refactor abandoned; else wire |
| `app/lib/dashboard-actions-settings.server.js` | 116 | dead router only | same |
| `app/lib/dashboard-actions-theme.server.js` | 85 | dead router only | same |
| `app/lib/dashboard-actions-step3.server.js` | 248 | dead router only | same |
| `app/lib/dashboard-helpers.server.js` | 213 | dead dashboard modules only | **delete** after wiring (live `safeSyncConfig` is inline in `app._index.jsx` `96–104`) |
| `app/lib/audit-run-hidden.server.ts` | 451 | **nothing** | Fork of `runHiddenAudit` — **delete** to prevent drift; live scan is `audit.server.ts` |

**Live dashboard split:** only `dashboard-report-loader.server.js` (22 lines) via `api.dashboard-report.jsx`.

**Related unwired UI (not in the 1,855 total):** `Step1AuditRunning.jsx` stop button; `stop-audit` intent exists only in the §17.3 dead action router.

### 17.4 Open build defects (documentation pass policy)

| Check | Status | Detail |
|---|---|---|
| `npm run lint` | **Fixed this session** | `theme-head-inject-utils.js` imports `node:process`; `AuditReportPanel.jsx` documents unused `OverviewLighthouse` |
| `npm run typecheck` | **Open — track in code** | `HiddenAuditResult` shape drift vs `audit-report-summary.server.ts`; `.ts` import extensions in `audit.server.ts`, `heal-template-config.server.ts`, `store-sync-audit.server.ts` |
| `npm test` | **Green** (113 pass, 6 skipped, 0 fail — verified this session) |

Typecheck fixes are **out of scope** for this doc pass unless explicitly requested; do not treat green tests as proof the dead modules work.

### 17.2 Repo files not in §17 / §24 (verdict)

| Path | Verdict | Evidence |
|---|---|---|
| `shopify.app.pagepulse.toml.org` | **Safe to delete** (backup) | Not read by CLI; live file is `shopify.app.pagepulse.toml` |
| `admin-panel/next.config.ts.org` | **Safe to delete** (backup) | Next reads `next.config.ts` only |
| `admin-panel/admindata-encrypted/` | **Keep if ops uses it** | Empty dir in this checkout; purpose UNVERIFIED — ask ops before delete |
| `.freebuff/` | **Empty placeholder** | No files; no app imports |
| `.cursor/rules/ponytail.mdc.disabled` | **Keep or delete** | Disabled rule; no runtime effect |
| `.eslintignore` / `.prettierignore` | **Keep** | ESLint/Prettier read via CLI (`npm run lint`) |
| `.editorconfig` | **Keep** | Editor formatting defaults |
| `.npmrc` | **Keep** | npm install behaviour |
| `.gitignore` / `.dockerignore` | **Keep** | git / Docker build context |
| `extensions/script-injector/locales/en.default.json` | **Safe to delete after rename** | Key `performance_scripts` does not match block handle `performance-loader`; Shopify i18n unused for schema name today |

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


### 20.8 Admin panel auth and queries (supplement)

| Module | Key symbols | Behaviour |
|---|---|---|
| `auth.ts` | `requireAdmin`, `loginAdmin`, `sessionVersion` | iron-session cookie `admin-session`; password change bumps `sessionVersion` and invalidates old cookies (`auth.ts` 12–14, 71+) |
| `rate-limit.ts` | `checkRateLimit`, `MAX_ATTEMPTS` | Login throttle (tested §26.2) |
| `queries.ts` | `getDashboardStats`, `getStores`, `getStoreByDomain` | Prisma reads; demo mode concatenates `dummy-data.ts` |
| `demo-mode.ts` | cookie `demo_mode`, `SHOW_DUMMY_DATA` | Fleet view mixing |
| `store-table.tsx` | Renders store list | Links to `[domain]` detail |

First admin: `admin-panel/scripts/ensure-admin.mjs` (not `prisma/seed.ts` on production boxes without devDeps).

### 20.8.1 Admin auth & store table — symbol tables

**`admin-panel/src/lib/auth.ts`**

| Name | File:line | Purpose |
|---|---|---|
| `getAdminSession` | `auth.ts:56` | iron-session cookie `admin-session`, 7-day TTL |
| `loginAdmin` | `71` | bcrypt compare (dummy hash on unknown email); sets `sessionVersion` from DB |
| `requireAdmin` | `112` | Re-loads user; invalidates cookie when `sessionVersion` mismatches (password change) |
| `requireRole` | `135` | Enforces `admin` vs `viewer` |
| `changeAdminPassword` | `204` | Bumps `sessionVersion` on user row |

**Rate limit:** `admin-panel/src/app/api/auth/login/route.ts` calls `checkRateLimit` from `rate-limit.ts` before `loginAdmin` (see §26.2).

**`admin-panel/src/components/store-table.tsx`**

| Name | File:line | Purpose |
|---|---|---|
| `StoreTable` (default) | `store-table.tsx:45` | Client table: search, status/appEnabled filters, sortable columns, pagination via URL query |
| `navigate` | `59` | Pushes `/dashboard/stores?...` with preserved filter state |
| `SORTABLE_COLUMNS` | `34` | shopName, domain, installedAt, appEnabled, … |

---

## 21. `AppConfig` TypeScript shape (`app/types/script.ts`)

```
appEnabled, script1Enabled, script2Enabled, script3Enabled,
scriptTitles: string[3],
debugMode,
auditDeferArray, auditHideSelectors, staticDeferDefaults, firstUserDelayScripts,
auditDeferArrayEnabled, auditHideSelectorsEnabled, staticDeferDefaultsEnabled,
firstUserDelayScriptsEnabled,
auditDeferArrayPreserved, auditHideSelectorsPreserved, staticDeferDefaultsPreserved,
firstUserDelayScriptsPreserved, firstUserDelayMs, everyTimeDelayMs,
auditComplete, appEndpoint
```

`storefrontPassword` / `customPlpUrl` / `customPdpUrl` /
`isPasswordProtected` / `cachedAppEndpoint` are **not** on `AppConfig`;
the dashboard loader adds the ones the wizard needs onto the returned
object.

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
| Storefront first-user delay | `firstUserDelayMs` default 12000 | `StoreConfig` → `generateDeferredScript` |
| Storefront every-load delay | `everyTimeDelayMs` default 6000 | `StoreConfig` → `generateDeferredScript` |
| Hide CSS gate | `html:not(.interacted) :is(…)` + `display:none` | `script-generator.js` `buildHiddenCss` |
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
| `PageDiscovery` | `audit.server.ts` | published collections + their best-selling products (+1 product fallback) unless custom URLs |
| `OnlineStorePasswordStatus` | `password-protection.server.ts` | Background check; secondary signal to the Chromium redirect probe |

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

---

---

## 25. PageSpeed Insights layer

| Module | Role |
|---|---|
| `psi.server.ts` | `fetchPsiLighthouse`, `parsePsiLighthouse`, skip rules, merchant-facing notes |
| `psi-scheduler.server.ts` | `schedulePsiAfterAudit`, 7-day `MIN_INTERVAL_MS`, per-shop jitter up to 12h |
| `psi-preview-url.server.ts` | Parse preview share URL → bypass params |
| `PsiSnapshot` | Optional raw storage model |
| `StoreConfig.psiFieldVitals` | Denormalized field vitals for UI |

**Skip:** `shouldSkipPsiFetch(true)` when password store with no preview params.

**Three merchant messages** (`psi.server.ts` 6–13): password unavailable; preview analyzed lock screen; preview expired.

**Env:** `GOOGLE_PSI_API_KEY` required for live fetch (`psi.server.ts` 129).

**Backoff:** `psiBackoffUntil` on repeated failures (scheduler).

### 25.1 `psi-scheduler.server.ts` — symbol table

| Name | File:line | Purpose |
|---|---|---|
| `schedulePsiAfterAudit` | `psi-scheduler.server.ts:26` | Fire-and-forget after audit; clears throttle fields then `runPsiJob` |
| `refreshPsiForShop` | `48` | Awaitable fetch; `force` clears `psiLastFetchedAt` / `psiBackoffUntil` |
| `claimPsi` / `psiInFlight` | `12–17` | Per-shop in-memory mutex — second concurrent job for same shop returns immediately |
| `jitterMs` | `20` | Deterministic 0…12h spread from shop domain hash (`MIN_INTERVAL_MS` is 7 days, `11`) |
| `runPsiJob` | `68` | Respects password skip, backoff, min interval + jitter; up to 3 HTTPS URLs × mobile/desktop |

**Backoff curve:** When `fetchPsiLighthouse` returns `backoffUntil`, `persistFieldVitals` writes `psiBackoffUntil` on `StoreConfig` (`152–164`) and the job exits early.

---

---

## 26. Tests (`npm test`)

Root: `node --test "tests/*.test.js"` (`package.json` 21). Admin:
`admin-panel/tests/rate-limit.test.ts` (run from admin-panel if wired in CI).

### 26.1 Root `tests/*.test.js`

| File | Protects | Named tests | Regression? | Not covered |
|---|---|---|---|---|
| `audit-candidates.test.js` | Token classification / URL parsing | `classifyCandidate marks chunk…`, `urlToCandidates never-defers checkout-web…`, `urlToCandidates buckets third-party…`, `coverageVerdict idle…`, `mergeSlugVariants…`, `pageMatchPatterns…` | General | Live Chromium |
| `audit-classify-contract.test.js` | Classifier fixtures stable | `audit classify contract fixtures` | Contract guard | Real storefront URLs |
| `audit-fold-policy.test.js` | Hide list vs fold assertion | `applyFoldPolicy passes…`, `applyFoldPolicy strips hide when fold assertion fails (D1=A)` | **D1=A fold bug** | DOM measurement |
| `audit-inventory.test.js` | Inventory status mapping | `inventory token mapping defers clarity host…` | General | Full audit run |
| `audit-inventory-build.test.js` | Report `topScripts` from inventory | `topScripts includes home request order…`, `topScripts lists classified tokens when…` | General | UI table render |
| `audit-lifecycle.test.js` | Stale sweep / progress flags | `auditProgressFlags…`, `lastSignOfLife…`, `staleReason…`, `queuedJobStale…`, `planStaleSweep…`, `needsOrphanStaleClear…` | Queue stale design | DB integration |
| `audit-popups.test.js` | Popup observer + cross-page veto | open/closed/dialog tests, hide CSS, cross-page veto, empty page | Popup false-positive class | Real merchant themes |
| `audit-psi-parse.test.js` | PSI JSON parse | `parsePsiLighthouse extracts category scores…` | General | Live Google API |
| `audit-psi-preview-url.test.js` | Preview bypass URL parsing | `parseThemePreviewShareUrl…`, `applyPsiPreviewBypass…`, `shouldSkipPsiForPasswordStore…`, `hasPsiPreviewBypass…`, `isPreviewBypassExpired…` | Password-store PSI | Scheduler jitter |
| `audit-psi-skip.test.js` | Skip PSI on password gate | `shouldSkipPsiFetch…`, `psiReportLooksLikePasswordGate…` | General | Full scheduler job |
| `audit-queue-policy.test.js` | Admission policy constants | `decideAdmission blocks duplicate…`, `decideAdmission allows enqueue when…`, `decideAdmission allows new shop…`, `STALE_RUNNING_MS is 15 minutes` | AUDIT-SYSTEM design | `enqueueAuditJob` wiring |
| `audit-report-summary.test.js` | Step 3 summary builder | `buildAuditReportSummary aggregates…`, `buildAuditReportSummary marks scans older than 30 days` | General | Loader route |
| `audit-report-summary-golden.test.js` | Summary JSON shape | `golden AuditReportSummary shape` | **UI contract** | PSI cards |
| `audit-script-actions.test.js` | `script-token-action` patch math | `buildArrayPatchForTokenAction…`, `applyScopedTokenAction…`, `effectiveListForScope…` | Step 3 token UI | Route action integration |
| `audit-template-buckets.test.js` | Per-template defer buckets | `buildTemplateDeferBuckets: global intersection…`, `buildTemplateDeferBuckets: PDP required PLP defer only` | Template scope bugs | DB columns |
| `audit-template-extra.test.js` | Merchant "+" extra pages | `applyExtraPageDeferRules adds…`, `applyExtraPageDeferRules vetoes…`, `urlToCandidates yields tokens…` | Extra-page rules | discoverPages |
| `performance-loader.test.js` | Liquid inline metafield contract | embed `compliance_head`, no proxy fetch, `MAX_CHUNKS`, json concat, stale chunk ignore | **Inline delivery** | Theme editor |
| `proxy-shop.test.js` | App Proxy HMAC + shop resolution | session shop, unsigned `?shop=` refused, canonicalisation, shopify-api parity, route fast path | **Unsigned shop regression** | Liquid render |
| `script-generator.test.js` | Obfuscated bundle behaviour | inline safety, timing logger, determinism, interaction release, delay lists, union fallback | Storefront gate bugs | Full obfuscation perf |
| `script-inline.test.js` | Metafield chunking + sync plan | `isSafeForInline`, `planMetafieldSync`, `splitScript`, `writeScriptMetafield`, `deleteScriptMetafield` | Shopify 65k limit | Admin API live |
| `theme-head-inject.test.js` | theme.liquid patch helpers | snippet path, `patchThemeLayoutHead` idempotent | Head inject | `themeFilesUpsert` API |
| `theme-head-inject-status.test.js` | Shopify exemption detection | `isThemeFilesExemptDenied detects…` | Theme API denial | Full inject flow |

### 26.2 `admin-panel/tests/rate-limit.test.ts`

| File | Protects | Named tests | Regression? | Not covered |
|---|---|---|---|---|
| `rate-limit.test.ts` | Login brute-force throttle | `allows attempts until the limit…`, `window expiry unblocks`, `success resets and keys are case-insensitive…` | Admin auth abuse | iron-session crypto |

### 26.3 Unprotected behaviour (intentional gaps)

| Area | Why no test | Risk |
|---|---|---|
| `runHiddenAudit` Chromium scroll/click phase | Needs headed/CI browser farm | Audit quality regressions |
| Theme embed on real shop | Needs Shopify theme render | Liquid/schema drift |
| `syncScriptMetafield` per-shop chain races | Needs Admin API + timing | Stale inline script |
| Webhook handlers (`webhooks.*.jsx`) | HMAC + Prisma integration | Uninstall/redact bugs |
| `app._index.jsx` loader fast path | Heavy mock of Admin GraphQL | Slow dashboard return |
| `enqueueAuditJob` / `drainAuditQueue` in production | Runner bypasses queue (`audit-runner.server.ts`) | Fleet overload |
| `inputsHash` skip-rebuild | Column unused in `app/lib` | Extra obfuscation CPU |

---

## 27. Operations and failure recovery

| Symptom | Check | Recovery (`file:line` cues) |
|---|---|---|
| Audit never finishes | `GET /api/audit/status` → `auditRunning`, `auditPhase`, `auditPageIndex` | Stale sweep: `audit-lifecycle.ts` `AUDIT_STALE_MS`; watchdog `maybeSweepStaleAuditStateForShop` (`audit-watchdog.server.ts` 164+). Orphan: `needsOrphanStaleClear` |
| Audit stuck “queued” | `AuditJob.status`, `activeAuditJobId` on `StoreConfig` | `audit-queue.server.ts` `failStaleQueuedJobs`; soak tooling `scripts/audit-soak.ts` |
| Storefront blank after enable | `shop.metafields['$app:pagepulse']` | `rebuildPerformanceScript` → `syncScriptMetafield` (`script-metafield.server.ts`); manual heal: `reconcileScriptMetafield` or `scripts/backfill-script-metafield.ts` — **not** on live dashboard load (dead loader only, §17.3) |
| Proxy serves old JS | `PerformanceScript.scriptHash` vs `ETag` | Merchant save triggers `rebuildPerformanceScript` (`app._index.jsx` toggle ~677); proxy lazy rebuild `api.storefront-scripts.jsx` 73–77 |
| PSI never updates | `psiLastFetchedAt`, `psiBackoffUntil`, `GOOGLE_PSI_API_KEY` | `refreshPsiForShop` / `schedulePsiAfterAudit` (`psi-scheduler.server.ts`); manual `scripts/refresh-psi.ts` |
| Typecheck red on audit summary | `HiddenAuditResult` vs `audit-report-summary.server.ts` | Fix types at source (`audit-core.server.ts` 50+); see §17 |
| First admin cannot log in | `AdminUser` row | `admin-panel/scripts/ensure-admin.mjs` via `npm run admin:ensure` (`admin-panel/package.json`) |

---

---

## 28. Appendix A — STALE / WRONG correction log

| Old claim (Oct-16 `PROJECT_FLOW.md`) | New truth | Evidence |
|---|---|---|
| §5 lists `api.audit.start.jsx`, `api.script.jsx`, … | Those route files **removed** | `glob app/routes/api.*` → 7 files only |
| §6: storefront compile on **every proxy request** | Proxy serves **prebuilt** `deferScript`; compile in `rebuildPerformanceScript` | `api.storefront-scripts.jsx` 13–15, 70–77 |
| §9–9.3: audit via `audit-script.ts` + `localStorage shopAuditP_v1` only | Live path is Playwright measure passes in `audit.server.ts` + inventory builders | `audit-runner.server.ts` imports `runHiddenAudit` from `audit.server.ts` |
| §10: Liquid **fetch** JSON proxy as primary | Primary is **inline metafield** + `compliance_head`; proxy is JS mirror / head inject | `performance-loader.liquid`, `pagepulse-inline.liquid` |
| §10.1: embed `target: head` | **`compliance_head`** | `performance-loader.liquid` 18 |
| §3 / §14: **8** migrations | **applied** — §3 tree + §14.2 now say **25** | `find prisma/migrations -name migration.sql` |
| §8: toggle OFF clears all audit arrays | Toggle OFF **does not** wipe audit state (only rebuilds empty script) | `app._index.jsx` 665–672 |
| §8.2: toggle ON always `resetAudit` + audit | ON enables scripts; **audit** on OFF→ON via `startAuditForStore`, not full reset | `app._index.jsx` 651–698 |
| Admin `sessionVersion` / PerformanceScript missing | Root schema includes them; admin copy updated but process debt remains | `prisma/schema.prisma` vs admin schema header comment |
| `BROWSER_IDLE_CLOSE_MS = 2 min` in server-load doc | Code shows **10s** in `audit.server.ts` 160 | grep constant |

---

---

## 29. Appendix B — File coverage manifest

> Line counts use the **`wc -l` convention** (newline-terminated lines; files without a trailing newline count one fewer than naive line splits). Regenerated from the tree **264** manifest rows + `ponytail/` out-of-scope row.

| Path | Lines | Coverage | Section |
|---|---:|---|---|
| `ponytail/` (tree) | — | deliberately out of scope | §3 |
| `.cursor/skills/install-performance-app/SKILL.md` | 230 | documented briefly | §17c |
| `.dockerignore` | 3 | documented briefly | §3–§15 |
| `.editorconfig` | 15 | documented briefly | §3–§15 |
| `.eslintignore` | 7 | documented briefly | §3–§15 |
| `.eslintrc.cjs` | 96 | documented briefly | §3–§15 |
| `.github/workflows/ci.yml` | 49 | documented briefly | §3 |
| `.gitignore` | 59 | documented briefly | §3–§15 |
| `.graphqlrc.js` | 38 | documented briefly | §3–§15 |
| `.mcp.json` | 9 | documented briefly | §3–§15 |
| `.npmrc` | 1 | documented briefly | §3–§15 |
| `.playwright-mcp/page-*.yml (27 snapshots)` | 16587 | not source — tool artifact, safe to gitignore | §3 |
| `.prettierignore` | 7 | documented briefly | §3–§15 |
| `.react-router/types/+future.ts` | 8 | documented briefly | §4 — RR typegen |
| `.react-router/types/+routes.ts` | 159 | documented briefly | §4 — RR typegen |
| `.react-router/types/+server-build.d.ts` | 17 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/+types/root.ts` | 67 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.audit.status.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.dashboard-report.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.embed-status.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.password-status.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.storefront-scripts.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.themes.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/api.toggle-validate.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/app._index.ts` | 73 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/app.extension.ts` | 73 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/app.settings.ts` | 73 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/app.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/auth.$.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/webhooks.app.scopes_update.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/webhooks.app.uninstalled.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/+types/webhooks.compliance.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/_index/+types/route.ts` | 70 | documented briefly | §4 — RR typegen |
| `.react-router/types/app/routes/auth.login/+types/route.ts` | 70 | documented briefly | §4 — RR typegen |
| `Dockerfile` | 21 | documented briefly | §3–§15 |
| `REQUIREMENTS_AND_PLANS.md` | 264 | documented briefly | §3 |
| `SCRIPT_DELAY_ANALYSIS_AND_PLAN.md` | 235 | documented briefly | §3 |
| `admin-panel/eslint.config.mjs` | 19 | documented briefly | §20 |
| `admin-panel/next-env.d.ts` | 6 | documented briefly | §20 |
| `admin-panel/next.config.ts` | 43 | documented briefly | §20 |
| `admin-panel/package-lock.json` | 7669 | documented briefly | §20 |
| `admin-panel/package.json` | 43 | documented briefly | §20 |
| `admin-panel/postcss.config.js` | 6 | documented briefly | §20 |
| `admin-panel/prisma/migrations/20260901095746_migrate_to_postgresql_add_models/migration.sql` | 133 | documented briefly | §14.2 |
| `admin-panel/prisma/migrations/20260902073700_drop_audit_columns/migration.sql` | 12 | documented briefly | §14.2 |
| `admin-panel/prisma/migrations/migration_lock.toml` | 3 | documented briefly | §20 |
| `admin-panel/prisma/schema.prisma` | 278 | documented briefly | §20 |
| `admin-panel/prisma/seed.ts` | 59 | documented briefly | §20 |
| `admin-panel/scripts/ensure-admin.mjs` | 110 | documented briefly | §20 |
| `admin-panel/src/app/api/auth/change-password/route.ts` | 47 | documented briefly | §20 |
| `admin-panel/src/app/api/auth/login/route.ts` | 72 | documented briefly | §20 |
| `admin-panel/src/app/api/auth/logout/route.ts` | 7 | documented briefly | §20 |
| `admin-panel/src/app/api/auth/setup/route.ts` | 70 | documented briefly | §20 |
| `admin-panel/src/app/api/auth/update-profile/route.ts` | 41 | documented briefly | §20 |
| `admin-panel/src/app/api/demo/route.ts` | 37 | documented briefly | §20 |
| `admin-panel/src/app/dashboard/layout.tsx` | 31 | documented briefly | §20 |
| `admin-panel/src/app/dashboard/page.tsx` | 76 | documented briefly | §20 |
| `admin-panel/src/app/dashboard/settings/page.tsx` | 9 | documented briefly | §20 |
| `admin-panel/src/app/dashboard/stores/[domain]/page.tsx` | 29 | documented briefly | §20 |
| `admin-panel/src/app/dashboard/stores/page.tsx` | 55 | documented briefly | §20 |
| `admin-panel/src/app/layout.tsx` | 19 | documented briefly | §20 |
| `admin-panel/src/app/login/page.tsx` | 96 | documented briefly | §20 |
| `admin-panel/src/app/page.tsx` | 19 | documented briefly | §20 |
| `admin-panel/src/app/setup/page.tsx` | 17 | documented briefly | §20 |
| `admin-panel/src/app/setup/setup-form.tsx` | 128 | documented briefly | §20 |
| `admin-panel/src/components/activity-timeline.tsx` | 83 | documented briefly | §20 |
| `admin-panel/src/components/config-viewer.tsx` | 84 | documented briefly | §20 |
| `admin-panel/src/components/country-chart.tsx` | 51 | documented briefly | §20 |
| `admin-panel/src/components/installs-chart.tsx` | 67 | documented briefly | §20 |
| `admin-panel/src/components/plan-chart.tsx` | 48 | documented briefly | §20 |
| `admin-panel/src/components/settings-client.tsx` | 295 | documented briefly | §20 |
| `admin-panel/src/components/sidebar.tsx` | 65 | documented briefly | §20 |
| `admin-panel/src/components/stats-cards.tsx` | 50 | documented briefly | §20 |
| `admin-panel/src/components/store-detail.tsx` | 147 | documented briefly | §20 |
| `admin-panel/src/components/store-table.tsx` | 214 | documented in full | §20.8.1 |
| `admin-panel/src/components/top-bar.tsx` | 70 | documented briefly | §20 |
| `admin-panel/src/components/ui/badge.tsx` | 29 | documented briefly | §20 |
| `admin-panel/src/components/ui/button.tsx` | 42 | documented briefly | §20 |
| `admin-panel/src/components/ui/card.tsx` | 36 | documented briefly | §20 |
| `admin-panel/src/components/ui/input.tsx` | 20 | documented briefly | §20 |
| `admin-panel/src/components/ui/label.tsx` | 17 | documented briefly | §20 |
| `admin-panel/src/components/ui/table.tsx` | 43 | documented briefly | §20 |
| `admin-panel/src/lib/auth.ts` | 219 | documented in full | §20.8.1 |
| `admin-panel/src/lib/data-source.ts` | 7 | documented briefly | §20 |
| `admin-panel/src/lib/demo-mode.ts` | 39 | documented briefly | §20 |
| `admin-panel/src/lib/dummy-data.ts` | 388 | documented briefly | §20 |
| `admin-panel/src/lib/prisma.ts` | 9 | documented briefly | §20 |
| `admin-panel/src/lib/queries.ts` | 336 | documented briefly | §20 |
| `admin-panel/src/lib/rate-limit.ts` | 107 | documented briefly | §20 |
| `admin-panel/src/lib/types.ts` | 115 | documented briefly | §20 |
| `admin-panel/src/lib/utils.ts` | 58 | documented briefly | §20 |
| `admin-panel/src/middleware.ts` | 38 | documented briefly | §20 |
| `admin-panel/tailwind.config.ts` | 53 | documented briefly | §20 |
| `admin-panel/tests/rate-limit.test.ts` | 38 | documented in full | §26 |
| `admin-panel/tsconfig.json` | 29 | documented briefly | §20 |
| `app/components/AuditReportPanel.jsx` | 611 | documented in full | §8.8.1 |
| `app/components/FooterBranding.jsx` | 100 | documented briefly | §4–§11 |
| `app/components/PpPillButton.jsx` | 36 | documented briefly | §4–§11 |
| `app/components/Step1Activate.jsx` | 948 | documented in full | §8.11 |
| `app/components/Step2Configure.jsx` | 61 | documented briefly | §4–§11 |
| `app/components/Step3AuditResults.jsx` | 46 | documented briefly | §4–§11 |
| `app/components/Step3Titles.jsx` | 553 | documented in full | §8.11 |
| `app/components/WizardNavigation.jsx` | 26 | documented briefly | §4–§11 |
| `app/components/WizardProgress.jsx` | 67 | documented briefly | §4–§11 |
| `app/components/step1/Step1AuditRunning.jsx` | 137 | documented briefly | §4–§11 |
| `app/components/step1/step1-shared.js` | 14 | documented briefly | §4–§11 |
| `app/db.server.js` | 11 | documented briefly | §4–§11 |
| `app/entry.server.jsx` | 65 | documented briefly | §4–§11 |
| `app/lib/audit-candidates.ts` | 387 | documented briefly | §4–§11 |
| `app/lib/audit-classified-inventory.ts` | 98 | documented in full | §9.5.5 |
| `app/lib/audit-core.server.ts` | 721 | documented briefly | §4–§11 |
| `app/lib/audit-fold-policy.server.ts` | 35 | documented briefly | §4–§11 |
| `app/lib/audit-gate-impact.server.ts` | 63 | documented briefly | §4–§11 |
| `app/lib/audit-inventory.server.ts` | 165 | documented briefly | §4–§11 |
| `app/lib/audit-lifecycle.ts` | 75 | documented briefly | §4–§11 |
| `app/lib/audit-logging.server.ts` | 18 | documented briefly | §4–§11 |
| `app/lib/audit-metrics.server.ts` | 79 | documented briefly | §4–§11 |
| `app/lib/audit-queue-policy.ts` | 26 | documented briefly | §4–§11 |
| `app/lib/audit-queue-reconcile.server.ts` | 232 | documented briefly | §4–§11 |
| `app/lib/audit-queue.server.ts` | 215 | documented briefly | §4–§11 |
| `app/lib/audit-report-summary.server.ts` | 157 | documented briefly | §4–§11 |
| `app/lib/audit-report-types.ts` | 156 | documented briefly | §4–§11 |
| `app/lib/audit-resource-tokens.ts` | 17 | documented briefly | §4–§11 |
| `app/lib/audit-run-hidden.server.ts` | 451 | documented — dead code | §17.3 |
| `app/lib/audit-run-page-measure.server.ts` | 1180 | documented briefly | §4–§11 |
| `app/lib/audit-run-page-timing.ts` | 12 | documented briefly | §4–§11 |
| `app/lib/audit-runner.server.ts` | 281 | documented briefly | §4–§11 |
| `app/lib/audit-script-actions-pure.ts` | 127 | documented briefly | §4–§11 |
| `app/lib/audit-script-actions.ts` | 66 | documented briefly | §4–§11 |
| `app/lib/audit-script.ts` | 49 | documented briefly | §4–§11 |
| `app/lib/audit-template-buckets.ts` | 89 | documented briefly | §4–§11 |
| `app/lib/audit-template-extra.ts` | 45 | documented briefly | §4–§11 |
| `app/lib/audit-watchdog.server.ts` | 268 | documented briefly | §4–§11 |
| `app/lib/audit.server.ts` | 2261 | documented in full | §9.6 |
| `app/lib/dashboard-actions-audit.server.js` | 242 | documented — dead code | §17.3 |
| `app/lib/dashboard-actions-settings.server.js` | 116 | documented — dead code | §17.3 |
| `app/lib/dashboard-actions-step3.server.js` | 248 | documented — dead code | §17.3 |
| `app/lib/dashboard-actions-theme.server.js` | 85 | documented — dead code | §17.3 |
| `app/lib/dashboard-actions.server.js` | 50 | documented — dead code | §17.3 |
| `app/lib/dashboard-helpers.server.js` | 213 | documented — dead code | §17.3 |
| `app/lib/dashboard-loader.server.js` | 450 | documented — dead code | §17.3 |
| `app/lib/dashboard-report-loader.server.js` | 22 | documented in full | §8.7 |
| `app/lib/heal-template-config.server.ts` | 49 | documented briefly | §4–§11 |
| `app/lib/metaobjects.ts` | 402 | documented in full | §12.2 |
| `app/lib/page-urls.server.ts` | 160 | documented briefly | §4–§11 |
| `app/lib/password-protection.server.ts` | 194 | documented briefly | §4–§11 |
| `app/lib/per-page.ts` | 59 | documented briefly | §4–§11 |
| `app/lib/performance-script.server.ts` | 223 | documented in full | §11.7.1 |
| `app/lib/popup-audit.js` | 37 | documented briefly | §4–§11 |
| `app/lib/proxy-shop.js` | 118 | documented briefly | §4–§11 |
| `app/lib/psi-preview-url.server.ts` | 106 | documented briefly | §4–§11 |
| `app/lib/psi-scheduler.server.ts` | 236 | documented in full | §25.1 |
| `app/lib/psi.server.ts` | 205 | documented briefly | §4–§11 |
| `app/lib/script-generator.js` | 700 | documented in full | §11.7.1 |
| `app/lib/script-inline.js` | 337 | documented in full | §11.7 |
| `app/lib/script-metafield.server.ts` | 238 | documented in full | §10.4.1 |
| `app/lib/scripts.ts` | 25 | documented briefly | §4–§11 |
| `app/lib/shopify-timeout.server.ts` | 30 | documented briefly | §4–§11 |
| `app/lib/shopify.js` | 12 | documented briefly | §4–§11 |
| `app/lib/store-heal.server.ts` | 22 | documented briefly | §4–§11 |
| `app/lib/store-sync-audit.server.ts` | 299 | documented briefly | §4–§11 |
| `app/lib/store-sync.server.ts` | 781 | documented in full | §12.2 |
| `app/lib/template-script-config.ts` | 139 | documented briefly | §4–§11 |
| `app/lib/theme-embed.server.js` | 233 | documented briefly | §4–§11 |
| `app/lib/theme-head-inject-status.server.ts` | 108 | documented briefly | §4–§11 |
| `app/lib/theme-head-inject-utils.js` | 56 | documented briefly | §4–§11 |
| `app/lib/theme-head-inject.server.ts` | 256 | documented in full | §10.3.1 |
| `app/lib/theme-head-patch.js` | 22 | documented briefly | §4–§11 |
| `app/lib/use-password-status.js` | 57 | documented briefly | §4–§11 |
| `app/root.jsx` | 24 | documented briefly | §4–§11 |
| `app/routes.js` | 3 | documented briefly | §4–§11 |
| `app/routes/_index/route.jsx` | 9 | documented briefly | §4–§11 |
| `app/routes/api.audit.status.jsx` | 35 | documented briefly | §4–§11 |
| `app/routes/api.dashboard-report.jsx` | 9 | documented briefly | §4–§11 |
| `app/routes/api.embed-status.jsx` | 39 | documented briefly | §4–§11 |
| `app/routes/api.password-status.jsx` | 25 | documented briefly | §4–§11 |
| `app/routes/api.storefront-scripts.jsx` | 127 | documented briefly | §4–§11 |
| `app/routes/api.themes.jsx` | 42 | documented briefly | §4–§11 |
| `app/routes/api.toggle-validate.jsx` | 133 | documented briefly | §4–§11 |
| `app/routes/app._index.jsx` | 1425 | documented in full | §8.10 |
| `app/routes/app.extension.jsx` | 122 | documented briefly | §4–§11 |
| `app/routes/app.jsx` | 48 | documented briefly | §4–§11 |
| `app/routes/app.settings.jsx` | 225 | documented briefly | §4–§11 |
| `app/routes/auth.$.jsx` | 17 | documented briefly | §4–§11 |
| `app/routes/auth.login/error.server.jsx` | 11 | documented briefly | §4–§11 |
| `app/routes/auth.login/route.jsx` | 47 | documented briefly | §4–§11 |
| `app/routes/webhooks.app.scopes_update.jsx` | 40 | documented briefly | §4–§11 |
| `app/routes/webhooks.app.uninstalled.jsx` | 46 | documented briefly | §4–§11 |
| `app/routes/webhooks.compliance.jsx` | 57 | documented briefly | §4–§11 |
| `app/shopify.server.js` | 34 | documented briefly | §4–§11 |
| `app/types/script.ts` | 65 | documented briefly | §4–§11 |
| `docker-compose.yml` | 17 | documented briefly | §3–§15 |
| `docs/SERVER-CAPACITY-AND-AUDIT-PERFORMANCE.md` | 589 | documented briefly | docs/ |
| `docs/server-load-reduce.md` | 1508 | documented briefly | docs/ |
| `extensions/script-injector/blocks/performance-loader.liquid` | 21 | documented briefly | §10 |
| `extensions/script-injector/locales/en.default.json` | 7 | documented briefly | §10 |
| `extensions/script-injector/shopify.extension.toml` | 4 | documented briefly | §10 |
| `extensions/script-injector/snippets/pagepulse-inline.liquid` | 11 | documented briefly | §10 |
| `init.sql` | 1 | documented briefly | §3–§15 |
| `package-lock.json` | 19977 | documented briefly | §3–§15 |
| `package.json` | 78 | documented briefly | §3–§15 |
| `pnpm-workspace.yaml` | 10 | documented briefly | §3–§15 |
| `prisma/migrations/20260901095746_migrate_to_postgresql_add_models/migration.sql` | 133 | documented briefly | §14.2 |
| `prisma/migrations/20260902073700_drop_audit_columns/migration.sql` | 12 | documented briefly | §14.2 |
| `prisma/migrations/20260903115942_add_static_defer_defaults/migration.sql` | 21 | documented briefly | §14.2 |
| `prisma/migrations/20260903132030_add_audit_progress_columns/migration.sql` | 3 | documented briefly | §14.2 |
| `prisma/migrations/20260903164006_reconcile_and_add_audit/migration.sql` | 61 | documented briefly | §14.2 |
| `prisma/migrations/20260907113428_add_storefront_password/migration.sql` | 5 | documented briefly | §14.2 |
| `prisma/migrations/20260907140000_add_audit_field_toggles/migration.sql` | 7 | documented briefly | §14.2 |
| `prisma/migrations/20260916112504_add_custom_page_urls/migration.sql` | 3 | documented briefly | §14.2 |
| `prisma/migrations/20260922085053_add_first_user_delay_scripts/migration.sql` | 6 | documented briefly | §14.2 |
| `prisma/migrations/20260922150000_add_password_protected_and_cached_endpoint/migration.sql` | 4 | documented briefly | §14.2 |
| `prisma/migrations/20260924120000_add_selected_theme_and_audit_pages/migration.sql` | 4 | documented briefly | §14.2 |
| `prisma/migrations/20260924130000_add_performance_script_hash/migration.sql` | 3 | documented briefly | §14.2 |
| `prisma/migrations/20260924140000_add_audit_phase/migration.sql` | 2 | documented briefly | §14.2 |
| `prisma/migrations/20260924150000_default_delay_scripts_wpm_gtm/migration.sql` | 3 | documented briefly | §14.2 |
| `prisma/migrations/20260924160000_backfill_delay_scripts_wpm_gtm/migration.sql` | 38 | documented briefly | §14.2 |
| `prisma/migrations/20260924170000_password_protected_nullable/migration.sql` | 8 | documented briefly | §14.2 |
| `prisma/migrations/20260930120000_admin_session_version/migration.sql` | 5 | documented briefly | §14.2 |
| `prisma/migrations/20260930150000_custom_page_urls/migration.sql` | 4 | documented briefly | §14.2 |
| `prisma/migrations/20261007120000_add_metafield_sync_columns/migration.sql` | 4 | documented briefly | §14.2 |
| `prisma/migrations/20261009140000_add_theme_head_inject_status/migration.sql` | 4 | documented briefly | §14.2 |
| `prisma/migrations/20261012120000_add_psi_field_columns/migration.sql` | 3 | documented briefly | §14.2 |
| `prisma/migrations/20261012140000_audit_job_and_psi_snapshot/migration.sql` | 91 | documented briefly | §14.2 |
| `prisma/migrations/20261013153000_psi_preview_bypass_params/migration.sql` | 1 | documented briefly | §14.2 |
| `prisma/migrations/20261013180000_template_script_columns/migration.sql` | 39 | documented briefly | §14.2 |
| `prisma/migrations/20261014120000_audit_job_active_unique/migration.sql` | 6 | documented briefly | §14.2 |
| `prisma/migrations/migration_lock.toml` | 3 | documented briefly | §14 |
| `prisma/schema.prisma` | 365 | documented briefly | §14 |
| `react-router.config.ts` | 15 | documented briefly | §3–§15 |
| `scripts/audit-soak.ts` | 22 | documented briefly | §15 |
| `scripts/backfill-script-metafield.ts` | 83 | documented briefly | §15 |
| `scripts/print-psi-test-url.ts` | 45 | documented briefly | §15 |
| `scripts/refresh-psi.ts` | 35 | documented briefly | §15 |
| `scripts/verify-step3-summary.ts` | 51 | documented briefly | §15 |
| `shopify.app.pagepulse.toml` | 113 | documented briefly | §3–§15 |
| `shopify.app.toml` | 95 | documented briefly | §3–§15 |
| `shopify.web.toml` | 8 | documented briefly | §3–§15 |
| `tests/audit-candidates.test.js` | 47 | documented in full | §26 |
| `tests/audit-classify-contract.test.js` | 36 | documented in full | §26 |
| `tests/audit-fold-policy.test.js` | 28 | documented in full | §26 |
| `tests/audit-inventory-build.test.js` | 75 | documented in full | §26 |
| `tests/audit-inventory.test.js` | 23 | documented in full | §26 |
| `tests/audit-lifecycle.test.js` | 155 | documented in full | §26 |
| `tests/audit-popups.test.js` | 168 | documented in full | §26 |
| `tests/audit-psi-parse.test.js` | 29 | documented in full | §26 |
| `tests/audit-psi-preview-url.test.js` | 51 | documented in full | §26 |
| `tests/audit-psi-skip.test.js` | 31 | documented in full | §26 |
| `tests/audit-queue-policy.test.js` | 26 | documented in full | §26 |
| `tests/audit-report-summary-golden.test.js` | 95 | documented in full | §26 |
| `tests/audit-report-summary.test.js` | 77 | documented in full | §26 |
| `tests/audit-script-actions.test.js` | 66 | documented in full | §26 |
| `tests/audit-template-buckets.test.js` | 38 | documented in full | §26 |
| `tests/audit-template-extra.test.js` | 51 | documented in full | §26 |
| `tests/performance-loader.test.js` | 137 | documented in full | §26 |
| `tests/proxy-shop.test.js` | 328 | documented in full | §26 |
| `tests/script-generator.test.js` | 161 | documented in full | §26 |
| `tests/script-inline.test.js` | 219 | documented in full | §26 |
| `tests/theme-head-inject-status.test.js` | 13 | documented in full | §26 |
| `tests/theme-head-inject.test.js` | 46 | documented in full | §26 |
| `tsconfig.json` | 23 | documented briefly | §3–§15 |
| `vite.config.js` | 62 | documented briefly | §3–§15 |


## 30. Appendix G — Glossary

| Term | Meaning |
|---|---|
| **Defer token** | Substring matched against script URLs to delay execution until interaction |
| **Hide selector** | CSS selector hidden until `html.interacted` |
| **Fold** | Top `FOLD_HEIGHT_PX` (1100px) band — hide candidates must not intersect |
| **Settle** | Quiet-period wait before measuring (see `audit-run-page-timing.ts`) |
| **Union fallback** | Legacy single-column lists when template buckets empty |
| **Scoped defer** | Per-template lists: Global/Home/Collection/Product |
| **coverage** | Whether a script ran before interaction (classification input) |
| **compliance_head** | Shopify embed slot rendered early in `<head>` |
| **inputsHash / metafieldHash** | Build fingerprint vs bytes live in Shopify metafields |
| **PSI field vs lab** | CrUX field data vs Lighthouse lab metrics |
| **Preview bypass** | `_bt` + `key` (+ `preview_theme_id`) for password-store PSI |
| **blocklist vs hide list** | Defer tokens delay JS; hide selectors apply CSS `display:none` until interaction |

