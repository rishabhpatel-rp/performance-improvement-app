# Performance Improvement App — Complete Project Flow

> This is the **single, authoritative** documentation file for this repository.
> It replaces every other `.md` file that previously existed at the project
> root (`README.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`, `Desing_plan.md`,
> `TECHNICAL_REQUIREMENTS.md`, all `IMPLEMENTATION_PLAN*.md` files). Those files
> described the project as it evolved feature‑by‑feature; this file describes
> the project **as it actually stands right now**, based on a full read of the
> source code.

---

## 1. What this project is

This is a **Shopify app** called "Performance Improvement App" (internal repo
name `performance-improvement-app`). Its job is to make a merchant's storefront
load faster by:

1. Running a **hidden, automated performance audit** of the merchant's store
   (Home, a Product Listing Page, a Product Detail Page) using a real headless
   browser (Playwright/Chromium).
2. Using the results of that audit to **defer/block third‑party scripts** and
   **hide off‑screen sections** on the live storefront until the customer
   actually interacts with the page (click, scroll, tap, etc.), which improves
   Core Web Vitals (especially LCP/TBT) without the merchant having to
   understand anything technical.
3. Delivering that logic to the storefront via a **Shopify Theme App
   Extension** (an app‑embed block that merchants toggle on in the theme
   editor) whose actual script contents are generated **server‑side** and
   served through Shopify's **App Proxy**, so nothing sensitive lives in the
   theme.

The repository is a **monorepo with two independent applications** that share
one PostgreSQL database:

| Module | Path | Framework | Audience | Purpose |
|---|---|---|---|---|
| **App** (Shopify embedded app) | `/app`, `/extensions`, root config | React Router 7 (Shopify's official app template, `@shopify/shopify-app-react-router`) | The merchant, inside Shopify Admin | Onboarding wizard, hidden audit engine, config storage, storefront script delivery |
| **Admin Panel** | `/admin-panel` | Next.js 15 (App Router) | Internal team (Brainvire / app owner), NOT the merchant | Cross‑store analytics dashboard: list every store that has installed the app, view each store's synced config and activity log, view install/plan/country charts |

They are **not** deployed as one server. They are two separate Node.js
projects, each with its own `package.json`, each independently deployable
(the root `Dockerfile` builds only the Shopify **app**; the admin panel has no
Dockerfile of its own and is expected to be deployed separately, e.g. Vercel
or its own container). The only thing that connects them is the **shared
Postgres database** — the Shopify app writes to it on every merchant action,
and the admin panel only reads from it (plus its own `AdminUser` table for
its own login).

---

## 2. Top-level repository layout

```
performance-improvement-app/
├── app/                        # Shopify embedded app source (React Router)
│   ├── components/             # Wizard UI (Step1Activate, Step2Configure, Step3Titles, ...)
│   ├── lib/                    # Business logic: metaobjects, audit engine, DB sync, script generation
│   ├── routes/                 # File-based routes (flatRoutes) — pages + API endpoints
│   ├── types/                  # Shared TS types (AppConfig, PredefinedScript)
│   ├── db.server.js            # Prisma client singleton
│   ├── shopify.server.js       # Shopify app SDK bootstrap (OAuth, sessions, webhooks)
│   ├── root.jsx                # HTML document shell
│   ├── entry.server.jsx        # SSR entry point (streaming renderer)
│   └── routes.js               # Wires up @react-router/fs-routes (flat file routing)
├── extensions/
│   └── script-injector/        # Theme App Extension (the thing merchants add in the theme editor)
│       ├── blocks/performance_scripts.liquid
│       ├── locales/en.default.json
│       └── shopify.extension.toml
├── prisma/
│   ├── schema.prisma            # Main app's Prisma schema (Postgres)
│   └── dev.sqlite                # Stale leftover from an earlier SQLite-based dev setup (unused; see §9 "Known issues")
├── admin-panel/                 # Second, independent Next.js application
│   ├── src/app/                 # Next.js App Router pages + API routes
│   ├── src/components/          # Dashboard UI (tables, charts, timeline, settings)
│   ├── src/lib/                 # auth.ts, queries.ts, prisma.ts, dummy-data.ts, demo-mode.ts
│   └── prisma/                  # Admin panel's OWN copy of the Prisma schema + migrations
├── build/                        # Compiled output of the React Router app (generated, not source)
├── shopify.app.toml               # Shopify CLI app config: scopes, webhooks, metaobject/metafield defs, app proxy
├── shopify.web.toml                # Shopify CLI "web" process config (dev/predev commands)
├── react-router.config.ts        # React Router build config (CSRF allowed-origins fix for local dev)
├── docker-compose.yml / init.sql # Local Postgres for development
├── Dockerfile                     # Production image for the Shopify app (NOT the admin panel)
├── package.json                   # Shopify app's dependencies/scripts
└── PROJECT_FLOW.md                # ← this file
```

---

## 3. Module 1 — The Shopify App (`/app`)

### 3.1 Tech stack

- **Framework**: React Router v7 in "framework mode" (this is Shopify's
  current official app template — the spiritual successor to their old Remix
  template). Routes are resolved via `@react-router/fs-routes` "flat routes"
  (`app/routes.js` just calls `flatRoutes()`), so the **filename** of each
  file under `app/routes/` determines its URL, using dot‑separated segments
  (e.g. `api.audit.start.jsx` → `/api/audit/start`).
- **Shopify SDK**: `@shopify/shopify-app-react-router` handles OAuth, session
  storage, webhook registration/verification, and App Bridge embedding.
- **Session storage**: Prisma-backed (`PrismaSessionStorage`), stored in the
  `Session` table in Postgres.
- **UI**: Shopify's new **Polaris web components** (`<s-page>`, `<s-section>`,
  `<s-button>`, `<s-switch>`, `<s-text-field>`, `<s-text-area>`, `<s-banner>`,
  `<s-spinner>`, etc.) — these are custom elements, not the older Polaris
  React component library. `AppProvider` from `@shopify/shopify-app-react-router/react`
  wraps the app for embedding inside Shopify Admin.
- **Database**: PostgreSQL via Prisma ORM.
- **Headless browser**: **Playwright** (`chromium`) — used server-side only,
  never shipped to the browser, to run the hidden audit.
- **API version**: Shopify Admin API `2026-10` (per `shopify.app.toml`
  webhooks block) / `ApiVersion.July26` in `shopify.server.js`.

### 3.2 Bootstrapping files

- **`app/shopify.server.js`** — creates the `shopifyApp(...)` instance:
  API key/secret from env, scopes from `SCOPES` env var
  (`read_themes,write_app_proxy,write_metaobject_definitions,write_metaobjects,write_products`
  per `shopify.app.toml`), `distribution: AppStore`, Prisma-backed session
  storage, `authPathPrefix: "/auth"`, and the `expiringOfflineAccessTokens`
  future flag (offline tokens now rotate/expire instead of living forever).
  Exports `authenticate`, `unauthenticated`, `login`, `registerWebhooks`,
  `sessionStorage`, `addDocumentResponseHeaders`.
- **`app/db.server.js`** — a singleton `PrismaClient`, cached on
  `global.prismaGlobal` in development so hot‑reloading doesn't exhaust
  Postgres connections.
- **`app/entry.server.jsx`** — SSR entry point. Uses
  `renderToPipeableStream` with a bot‑vs‑human callback strategy
  (`onAllReady` for bots/crawlers so they get the fully rendered HTML;
  `onShellReady` for real users so they get a fast streamed shell), a 5s
  stream timeout, and calls `addDocumentResponseHeaders` so Shopify's
  required CSP/frame headers are attached to every document response.
- **`app/root.jsx`** — the top‑level HTML document: loads Shopify's hosted
  Inter font stylesheet and preconnects to `cdn.shopify.com`.
- **`app/routes.js`** — just `export default flatRoutes()`, meaning every
  route below is discovered purely by file name under `app/routes/`.
- **`react-router.config.ts`** — allows the app's own host as a CSRF‑safe
  action origin. This works around a dev‑only quirk where the Shopify CLI's
  local HTTPS proxy makes the browser's `Origin` header (`https://...`)
  mismatch the server's derived request URL (`http://...`), which would
  otherwise make every form/`useFetcher` POST fail with 400.

### 3.3 Routing map (everything under `app/routes/`)

| Route file | URL | Type | Purpose |
|---|---|---|---|
| `_index/route.jsx` | `/` | Page (loader only) | Immediately redirects to `/app` (preserving query params like `shop=`), since there's no separate marketing landing page — the wizard *is* the app. |
| `auth.$.jsx` | `/auth/*` | Page (loader only) | Catch‑all hit by Shopify right after OAuth completes. Calls `authenticate.admin` then `ensureConfig(admin)` so the config metaobject exists before the merchant ever sees the dashboard. |
| `auth.login/route.jsx` | `/auth/login` | Page | Manual "enter your shop domain" login form (used for non‑embedded/standalone login flows), via Shopify's `login()` helper. |
| `app.jsx` | `/app` (layout) | Layout route | The authenticated shell for every `/app/*` page. Authenticates the request, wraps children in `<AppProvider embedded apiKey=...>`, renders the top nav (`Dashboard`, `Settings`), and exposes a shared `ErrorBoundary`/`headers` export (Shopify boundary helpers so 401s etc. bounce the merchant back through OAuth correctly). |
| `app._index.jsx` | `/app` | Page (loader + action) | **The main dashboard — the entire onboarding wizard lives here.** See §3.5 below; this is the most important file in the app. |
| `app.settings.jsx` | `/app/settings` | Page (loader + action) | Secondary settings page: Debug‑mode toggle, a deep link into the theme editor, and a "Reset all data" danger‑zone button that deletes the config metaobject and zeroes the DB config. |
| `webhooks.app.uninstalled.jsx` | `/webhooks/app/uninstalled` | Webhook action | On uninstall: marks the `Store` row `isActive=false` + `uninstalledAt`, logs an `uninstalled` activity, deletes the config metaobject (best‑effort, since API access may already be revoked), deletes the Shopify `Session` rows for that shop. |
| `webhooks.app.scopes_update.jsx` | `/webhooks/app/scopes_update` | Webhook action | On scope changes: updates the session's stored `scope`, updates `Store.currentScope`, logs a `scope_updated` activity. |
| `api.audit.start.jsx` | `/api/audit/start` (action only) | Internal API | Manually (re)start the hidden Playwright audit for the current shop. Mirrors the auto‑start logic in `app._index.jsx`'s action, but callable directly. |
| `api.audit.status.jsx` | `/api/audit/status` (loader only) | Internal API | Polled every 3s by the dashboard while an audit is running; returns `{running, complete, failed, error, pageIndex, totalPages, progress}` read straight from `StoreConfig`. |
| `api.step-3.jsx` | `/api/step-3` (action only, POST) | Internal API | Returns the (currently empty — see §9) list of predefined script definitions for the wizard. |
| `api.script.jsx` | `/api/script` (loader only, **public**, App‑Proxy‑authenticated) | **Storefront‑facing** | The URL the theme embed block actually loads today. Builds and returns a small JS bundle. Currently a **placeholder/dummy** bundle (see §9) — not yet the real defer logic. |
| `api.storefront-scripts.jsx` | `/api/storefront-scripts` (loader only, **public**, App‑Proxy‑authenticated) | **Storefront‑facing** | Builds the **real** deferred‑script bundle (via `generateDeferredScript`) from the shop's DB‑stored audit arrays. **Not currently linked from the theme extension** (see §9) — it exists and works, it's just not wired up to the live embed block yet. |
| `api.save-performance-scripts.jsx` | `/api/save-performance-scripts` (action only) | Internal API | Upserts a `PerformanceScript` row (`auditScript`/`deferScript`/`hiddenCss` raw text) for the shop. |

### 3.4 The Shopify‑side app configuration (`shopify.app.toml`)

This file is what `shopify app config push`/`deploy` uses to create/update
Shopify‑side objects:

- **Access scopes**: `read_themes, write_app_proxy, write_metaobject_definitions, write_metaobjects, write_products`.
- **Webhooks** (API version `2026-10`): `app/scopes_update`, `app/uninstalled`.
- **App proxy**: `prefix = "apps"`, `subpath = "my-first-custom-app"` → any
  request to `https://<shop>/apps/my-first-custom-app/*` on the storefront is
  proxied by Shopify to this app's `/api/storefront-scripts`-style routes
  ("apps/my-first-custom-app" is the storefront‑facing alias; Shopify strips
  the prefix/subpath and forwards to the app's configured proxy URL,
  `.../api/storefront-scripts`).
- **Metaobject definition** `$app:script_injector_config` (namespaced with
  the reserved `$app:` prefix at runtime) — this is the **primary
  configuration object for the merchant's script settings**, stored inside
  Shopify itself (not just in this app's database). Fields:
  `app_enabled`, `script_1_enabled`, `script_2_enabled`, `script_3_enabled`,
  `script_titles` (list), `debug_mode`, `audit_defer_array` (list),
  `audit_hide_selectors` (list), `audit_complete`, `app_endpoint` (url).
- There's also a demo metaobject (`app.example`) and a demo product metafield
  (`demo_info`) left over from the original Shopify CLI template scaffold —
  unused by the actual feature set, harmless template cruft.

### 3.5 The Dashboard / Onboarding Wizard (`app/routes/app._index.jsx`)

This is a **2‑step wizard** (despite `Desing_plan.md`'s original spec
describing 3 steps — the actual shipped UI merged what was originally
"Step 3" into "Step 2"; see `WizardProgress.jsx`'s `STEP_LABELS = ["Start",
"Scripts + Titles"]`).

**Step 1 — Activate** (`Step1Activate.jsx`)
- A single big ON/OFF switch: "Enable Performance Improvement App"
  (`appEnabled`). Submitted immediately via `useFetcher` (`intent:
  "toggle-app"`) — no separate Save button.
- Turning the app **ON**:
  1. The action sets `script1Enabled/script2Enabled/script3Enabled = true`
     by default in the metaobject (merchant can turn individual scripts off
     later in Step 2).
  2. Calls `resetAudit(admin)` — clears `audit_defer_array`,
     `audit_hide_selectors`, `audit_complete=false` on the metaobject, so a
     fresh audit will run.
  3. Kicks off `startHiddenAudit(admin, shop)` **in the background**
     (fire‑and‑forget async IIFE) — the HTTP action returns immediately.
  4. The dashboard optimistically flips into a "running" UI state even
     before the server action resolves (via the fetcher's in‑flight
     `formData`).
- Turning the app **OFF**: also calls `resetAudit` and clears the DB's audit
  status fields, so the *next* OFF→ON cycle always re‑audits from scratch.
- While the hidden audit runs, this step shows a spinner, a 120‑second
  visual countdown, and a progress bar driven by polling
  `/api/audit/status` every 3 seconds (`useEffect` + `setInterval` in
  `app._index.jsx`'s `Dashboard` component). When the poll reports
  `complete: true`, the wizard **auto‑advances to Step 2**.
- Also on this screen: an optional **"Password‑protected store?"** panel.
  If the merchant's storefront has Shopify's storefront password enabled
  (e.g. a dev/staging store), they can enter that password here
  (`intent: "save-storefront-password"`, stored in `StoreConfig.storefrontPassword`,
  DB‑only, never on the metaobject). The hidden audit engine uses this
  password + the active theme ID to build Shopify's documented
  `?password=...&preview_theme_id=...` bypass URLs so the headless browser
  can actually reach the storefront instead of hitting the password wall.

**Step 2 — Configure** (`Step2Configure.jsx`, unlocked only once
`appEnabled && auditStatus.complete`)
- One switch per predefined script slot (`script1Enabled/2/3`), labelled
  with the merchant's custom title from `scriptTitles[i]` if set, otherwise
  a default name from `PREDEFINED_SCRIPTS` (see §9 — this array is
  currently empty, so in practice **this list renders no rows today**).
  Disabled entirely while the app itself is off.
- **Nests `Step3Titles.jsx` inside it** (the "audit results" editor,
  originally a separate Step 3, now folded into the Step‑2 screen):
  three independently toggleable, independently saveable textareas, each
  validated as strict JSON array‑of‑strings:
  1. **"Defer Heavy Scripts"** (`auditDeferArray`) — script src fragments /
     hostnames the audit found and that should be blocked until
     interaction.
  2. **"Hide Lastfold Classes"** (`auditHideSelectors`) — CSS selectors for
     off‑screen sections the audit found.
  3. **"Delay Scripts"** (`staticDeferDefaults`) — a static, always‑applied
     defer list independent of the audit (defaults to
     `["wpm","gtm","clarity"]`).
  - Each box has its **own** ON/OFF toggle (`intent: "toggle-audit-field"`).
    Turning a box **off** snapshots its current value into a
    "preserved" column (`auditDeferArrayPreserved`, etc.) and blanks the
    active column to `[]` — the storefront then receives nothing for that
    field — while the real data is never deleted. Turning it back **on**
    restores from the preserved column. This preserve/restore dance is
    implemented in `updateAuditFieldToggle()` in `store-sync.server.ts`.
  - Each box has its own **Save** button (`intent: "save-audit-arrays"`),
    enabled only when the JSON is valid *and* the text differs from the
    last saved value. Saving is **DB‑only** — it deliberately bypasses the
    Shopify metaobject entirely (see §3.6 for why).

**`WizardNavigation.jsx`** — pure Back/Continue/Done buttons; "Continue" is
disabled until `maxStep` (computed in the parent) allows advancing (i.e.
until the app is on and the audit is done). "Done" just resets
`currentStep` back to 1 (each step already auto‑saves its own fields via
fetchers, so there's nothing to save on exit).

**`FooterBranding.jsx`** — static branding block ("🚀 PERFORMANCE APP",
tagline, non‑functional "Terms of use" link placeholder).

### 3.6 Two sources of truth for configuration: Metaobject vs. Postgres

This is the single most important architectural fact about the app module,
and it's deliberate (documented inline in the code, particularly
`store-sync.server.ts`'s `syncConfigToDatabase`):

- **Shopify Metaobject** (`$app:script_injector_config`) is the source of
  truth for: `app_enabled`, `script_1/2/3_enabled`, `script_titles`,
  `debug_mode`, `audit_complete`, `app_endpoint`. These are simple flags
  that make sense to live "inside Shopify" (portable if the app's own DB
  were ever lost, visible via GraphQL Admin API, etc). Read/write helpers
  live in **`app/lib/metaobjects.ts`**: `getConfig`, `updateConfig`,
  `ensureConfig` (creates it on first OAuth if missing), `deleteConfig`,
  `ensureAppEndpoint` (keeps the `app_endpoint` field in sync with
  `SHOPIFY_APP_URL` automatically, every dashboard load), `resetAudit`.
- **Postgres (`StoreConfig` table)** is the *exclusive* source of truth for
  the three Step‑3 audit arrays (`auditDeferArray`, `auditHideSelectors`,
  `staticDeferDefaults`), their enabled/disabled toggle state, their
  "preserved" snapshots, the storefront password, and the entire hidden
  audit lifecycle (`auditRunning`, `auditComplete`, `auditFailed`,
  `auditError`, `auditPageIndex`, `auditTotalPages`, `lastAuditAt`). These
  are DB‑only **by design** — they're too large/volatile to comfortably fit
  Shopify metaobject field constraints and don't need to be Shopify‑native.
- **Every dashboard load** (`app._index.jsx`'s `loader`) does all of the
  following, in order:
  1. Fetch live shop details from Shopify (`fetchShopDetailsFromShopify`)
     and `upsertStore()` them into Postgres (name, address, plan, product
     count, order count, timezone, currency, etc.) — this is also how the
     admin panel's `Store` table stays fresh, since it's the same table.
  2. `ensureConfig` + `ensureAppEndpoint` against the metaobject.
  3. `syncConfigToDatabase()` — mirrors the metaobject's flags into
     `StoreConfig`, but **deliberately excludes** `auditComplete` and the
     three audit arrays from the "update" branch, so a routine page load
     can never clobber real audit results with the metaobject's (usually
     empty) mirrored values.
  4. Overlay: read the DB‑authoritative audit arrays/toggles/preserved
     values *on top of* the merged metaobject config, so the DB always wins
     for those fields.
  5. Log an `installed` activity the **first time** a `Store` row is
     created for that shop (detected via `isNewStore` — whether a `Store`
     row existed *before* this load's `upsertStore` call).

### 3.7 The hidden audit engine (`app/lib/audit.server.ts` + `audit-script.ts`)

This is the technical core of the product. It runs entirely server‑side,
invisible to the merchant except for a progress bar.

1. **`discoverPages(admin, shopDomain, password?, themeId?)`** — figures out
   three URLs to audit:
   - **Home**: `https://{shop}/`
   - **PLP**: tries Admin GraphQL first (`collections(first:1)`) for a clean
     collection handle; **falls back** to launching a headless Chromium,
     loading the homepage, and scraping the first `a[href*="/collections/"]`
     link if GraphQL didn't yield one.
   - **PDP**: same pattern via `products(first:1)` / scraping
     `a[href*="/products/"]`.
   - If a storefront password was saved in Step 1, every discovered URL
     gets Shopify's documented bypass query params appended
     (`appendPasswordBypass` → `?password=...&preview_theme_id=...`), and
     `getActiveThemeId(admin)` supplies the theme id via the most recently
     updated theme.
   - Throws if a PLP or PDP still can't be found after both attempts (audit
     cannot proceed with fewer than 3 pages).

2. **`runHiddenAudit({pages, password, onProgress})`** — launches a fresh
   headless Chromium browser + a **persistent browsing context** (so
   `localStorage` survives page‑to‑page navigation, exactly like a real
   visitor's session would):
   - Injects the **verbatim audit script** (see below) via
     `page.addInitScript` so it re‑runs automatically after every
     navigation (script tags don't survive a full page load, but init
     scripts do).
   - Navigates to Home first. If a storefront password wall is detected
     (form/`input[name=password]` present) even after the query‑param
     bypass, it programmatically fills and submits the password form as a
     fallback.
   - Polls the audit script's own `localStorage` accumulator
     (`shopAuditState_v1.currentIndex`) once a second to report
     `{pageIndex, total}` progress back up through the `onProgress`
     callback — this is what powers the dashboard's live progress bar via
     `StoreConfig.auditPageIndex/auditTotalPages`.
   - Waits (up to `pages.length * 40s + 60s`) for the script's own
     `currentIndex` counter to reach `pages.length`, meaning the script has
     finished walking every page.
   - Finally re‑reads three `localStorage` keys from the origin
     (`shopAuditP_v1`, `shopAuditVisible_v1`, `shopAuditOff_v1`) and derives:
     - `deferArray` = every distinct third‑party‑script filename/hostname
       candidate found across all pages, sorted.
     - `hideSelectors` = every CSS selector that was **off‑screen on every
       page it appeared on** (i.e. never visible anywhere), sorted.
   - Always closes the browser in a `finally` block.

3. **The audit script itself (`audit-script.ts`'s `AUDIT_SCRIPT` constant)**
   — a **minified, verbatim, do‑not‑rewrite** third‑party‑style JS payload
   (explicitly commented "IMPORTANT: Do NOT rewrite the audit logic") that:
   - Walks a list of pages (`PAGES`, injected via a single string
     substitution — `buildAuditScriptWithPages()` swaps `var PAGES=[];` for
     the real URLs, nothing else in the script is touched).
   - On each page, waits 40 seconds (to let lazy content, ads, trackers,
     etc. actually load and register themselves — this is why the whole
     audit takes minutes, and why the dashboard shows a 120s countdown),
     then:
     - **`auditP()`**: collects every `<script src>` and every
       `performance.getEntriesByType('resource')` script‑initiated resource,
       extracts either the filename (if it "looks" like a real, non‑hashed
       script name — filters out pure numbers, high digit‑density strings,
       Shopify/CDN/checkout/storefront hostnames, `chunk`‑named files) or
       the **hostname** (if it's a genuine third‑party host), and adds
       surviving candidates to the `P` accumulator. This becomes the
       `auditDeferArray` — patterns later matched against script `src`
       attributes to gate them behind first interaction.
     - **`auditSelectors()`**: walks every "major" element (has a class or
       id, isn't tiny, isn't display:none) and classifies it as visible or
       off‑screen using `getBoundingClientRect`. It's smart about **runs of
       off‑screen siblings** — if a container's children from some index
       onward are *all* off‑screen (a common footer/related‑products
       pattern), it emits one compact `:nth-child(n+N)` selector instead of
       one selector per element. Anything seen visible on **any** audited
       page is excluded from the final off‑screen selector set (a section
       that's below the fold on Home but visible on PDP shouldn't be
       globally hidden).
   - Persists everything to `localStorage` after each page, then
     **navigates itself** (`location.href = PAGES[nextIndex]`) to the next
     page — this is why a real browser session (not just parallel fetches)
     is required; it's simulating actual multi‑page browsing behavior.
   - After the last page, calls `outputFinal()` which (for human debugging
     in a real browser) `console.log`s the final `P` array and selector
     list and copies a ready‑to‑paste snippet to the clipboard — this
     console/clipboard behavior is irrelevant when run headlessly by
     Playwright (nothing is watching the console), the *real* consumer of
     the result is `runHiddenAudit()` reading the same `localStorage` keys
     directly.

4. **Saving results** (`saveAuditReport()` in `store-sync.server.ts`):
   - Respects each field's current enabled/disabled toggle: if
     `auditDeferArrayEnabled` is currently off, the freshly audited defer
     array is stashed into the *preserved* column instead of overwriting
     the (intentionally empty) active column — so a merchant who disabled a
     field before re‑running the audit doesn't get it silently re‑enabled.
   - Writes `StoreConfig.auditComplete/auditRunning/auditFailed/lastAuditAt`.
   - Also stores the **entire raw report JSON** into
     `PerformanceScript.auditScript` (upserted) as a debugging/history
     artifact, and appends a row to `AuditLog` (domain, `audit_type:
     "auto-audit"`, full `audit_data`, `status`).
   - On any error anywhere in the audit pipeline, the running flag is
     cleared, `auditFailed=true` and the error message is stored so Step 1
     can show "Audit failed: ...".

### 3.8 Delivering the result to the storefront

Two different mechanisms exist in the codebase for this — only one is
currently live (see §9 for the discrepancy):

- **Theme App Extension** (`extensions/script-injector`): a single Liquid
  app‑embed block (`performance_scripts.liquid`) targeting `head`. Its
  entire body is:
  ```html
  <script src="/apps/my-first-custom-app?v={{ 'now' | date: '%s' }}" defer></script>
  ```
  The merchant enables this in the Shopify **theme editor → App embeds**
  panel (a deep link to that exact screen is provided by
  `getThemeEditorDeepLink()`, surfaced as an "Open theme editor" button on
  the app's Settings page). Shopify's App Proxy rewrites
  `/apps/my-first-custom-app` to this app's configured proxy target.

- **`api.script.jsx`** (`loader`) — **this is what the proxy URL above
  currently resolves to**. It authenticates via
  `authenticate.public.appProxy(request)` (verifies Shopify's HMAC‑signed
  proxy request, resolves `shop` + an admin GraphQL client from the signed
  session — no client‑supplied shop parameter is ever trusted), reads
  `appEnabled`/`debugMode` from the metaobject, and returns a small
  self‑contained bundle that, when `appEnabled`, injects **two no‑op
  placeholder `<script>` tags and one no‑op `<style>` block** into
  `<head>`, logging progress to the console. The file's own header comment
  is explicit that this exercises the *delivery path* only — "Nothing is
  collected, blocked, or hidden. Real logic is added before launch."

- **`api.storefront-scripts.jsx`** (`loader`) — the **real, production‑grade
  bundle generator**, also App‑Proxy‑authenticated, but **not currently
  referenced by the Liquid block** (which still points at
  `/apps/my-first-custom-app` → `api.script.jsx`). It:
  - Looks up the `Store` + its most‑recently‑updated `StoreConfig` by
    `shopDomain` from the signed proxy session.
  - Serves a no‑op comment (`/* performance app disabled */`) if the store
    is inactive or the app is off.
  - Otherwise reads `auditDeferArray`/`staticDeferDefaults` **respecting
    their per‑field enabled toggles** (an off toggle serves `[]` even
    though the DB still holds the real preserved data), and passes them
    into `generateDeferredScript()` (`app/lib/script-generator.js`) to
    produce the actual bundle text, served with
    `Cache-Control: public, max-age=300`.

- **`generateDeferredScript(auditArray, deferArray)`** — this is the
  **real optimization payload** meant to ship to real customers. In four
  sections:
  1. **Interaction detection**: listens once for the first
     `pointerdown/click/keydown/touchstart/wheel/scroll/mousemove/focus`
     and adds an `interacted` class to `<html>` (and an `f-interacted`
     class beforehand, tracked via a `localStorage` flag so repeat visits
     in the same browser don't re‑show a "waiting for interaction" state).
  2. **Regex‑based script gating (`var P` = `auditArray`)**: monkey‑patches
     `Element.prototype.appendChild/insertBefore/setAttribute` and
     `Node.prototype.replaceChild`, plus the native `<script>.src` setter,
     so that *any* script tag whose eventual `src` matches one of the audit
     patterns gets its `type` flipped to `"text/plain"` and its `src`
     stripped **before the browser ever requests it** — effectively
     pausing it. A `MutationObserver` also catches scripts injected later
     by other code. The instant the user interacts
     (`site:interacted` custom event), every gated `<script type="text/plain">`
     is rebuilt as a real `<script>` with its original `src` and appended
     to `<head>`, releasing it.
  3. **First‑interaction hard delay (`FIRST_USER_DELAY_SCRIPTS =
     ["wpm","gtm","clarity"]`, 12s cap)**: a second, independent gate — any
     script whose src matches this hardcoded list is held via the same
     `src`‑setter‑interception trick, but is released either on first
     interaction **or** after a flat 12‑second timeout, whichever comes
     first (so tracking/analytics scripts always eventually load, even on
     a visitor who never interacts).
  4. **Every‑time delay block (`var EVERY_TIME_DELAY_SCRIPTS` =
     `staticDeferDefaults`, 6s flat delay, every page load)**: a third,
     independent, unconditional 6‑second delay applied to whatever's in
     the merchant's "Delay Scripts" list, released purely by timer with no
     interaction dependency at all.
  - All three gating mechanisms are **independent and can overlap** — a
    script matching more than one list is subject to whichever gate
    releases it soonest.

### 3.9 Webhooks & lifecycle

- **`app/uninstalled`**: robust to partial state (session/admin may already
  be gone by the time this fires) — marks the DB store inactive, logs the
  event with whatever shop name/plan the webhook payload still carries,
  attempts metaobject cleanup only if a session/admin client is still
  available, and deletes the app's own `Session` rows for that shop last.
- **`app/scopes_update`**: keeps both the Shopify session row and the
  `Store.currentScope` DB column in sync whenever the merchant
  approves/changes granted scopes, and logs a `scope_updated` activity
  visible in the admin panel's timeline.

---

## 4. Module 2 — The Admin Panel (`/admin-panel`)

### 4.1 Purpose & audience

This is a **separate, internal‑only** Next.js 15 (App Router) application.
It is **not** shown to merchants and has nothing to do with Shopify OAuth —
it's a private dashboard for whoever runs this app (Brainvire/the app owner)
to see, across **every store that has ever installed the Shopify app**:
overall install/active/inactive counts, install trend over time, country and
plan breakdowns, a searchable/paginated store list, a per‑store detail view
(store info + its synced config + its full activity timeline), and basic
account/profile administration for the internal team members who use this
panel.

### 4.2 Tech stack

- **Next.js 15** (App Router, React 19).
- **Auth**: `iron-session` (encrypted, stateless cookie‑based sessions — no
  server‑side session table needed) + `bcryptjs` for password hashing.
  Cookie name `admin-session`, 7‑day max age, `httpOnly`, `secure` in
  production.
- **Database**: the exact same Postgres database as the Shopify app, via its
  **own copy** of a Prisma client (`src/lib/prisma.ts`) and its **own copy**
  of the schema (`admin-panel/prisma/schema.prisma`) — see §6 for why this
  matters.
- **Styling**: Tailwind CSS + a small local shadcn/ui‑style component kit
  (`src/components/ui/*`: Button, Input, Label, Card, Table, Badge).
- **Charts**: `recharts` (installs‑by‑day line chart, country bar chart,
  plan pie/bar chart).

### 4.3 First‑run / auth flow

1. **`middleware.ts`** runs on every request except `/api/*`,
   `/_next/*`, `/favicon.ico`. It's a cheap, Edge‑runtime,
   **cookie‑presence‑only** check (it can't decrypt the iron‑session
   payload on the Edge runtime, and can't touch Prisma there either):
   redirects `/` based on whether *any* `admin-session` cookie is present,
   redirects any other page to `/login` if no cookie exists at all, and
   passes `/login`/`/setup` straight through untouched.
2. **`/` (`page.tsx`)** is the real source of truth: calls
   `requireAdmin()` (which *does* decrypt/validate the session
   server‑side) — if valid, redirect to `/dashboard`; if no admin user
   exists **at all** yet in the DB, redirect to `/setup`; otherwise
   `/login`.
3. **`/setup` (`page.tsx` + `POST /api/auth/setup`)** — a one‑time "create
   the first admin account" form. The API route **refuses outright** if
   `hasAnyAdminUser()` is already true (`409 Setup has already been
   completed`) — this can never be used to create a second privileged
   account later, only the very first one. Requires an 8+ character
   password. On success, immediately logs the new user in.
   (There is also a `prisma/seed.ts` script that can create a default admin
   — `admin@performance-app.com` / `admin123` unless overridden by
   `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/`SEED_ADMIN_NAME` env vars — as
   an alternative bootstrap path to the `/setup` UI.)
4. **`/login` (`page.tsx` + `POST /api/auth/login`)** — standard
   email/password form; `loginAdmin()` verifies via `bcrypt.compare`,
   updates `lastLoginAt`, and populates the iron‑session cookie.
5. **`src/app/dashboard/layout.tsx`** (wraps every `/dashboard/*` page) —
   calls `requireAdmin()` server‑side again (defense in depth beyond the
   middleware), redirects to `/login` if invalid, and renders the
   `Sidebar` (nav: Dashboard / Stores / Settings, current user's
   name/email, a logout button that POSTs `/api/auth/logout` then
   redirects).
6. **`SESSION_PASSWORD`** (env var `ADMIN_SESSION_PASSWORD`) must be ≥32
   characters. In production, a missing/short secret **throws at import
   time** (fail loudly rather than silently run with a guessable key); in
   development it falls back to a hardcoded insecure string with a console
   warning.

### 4.4 Pages

- **`/dashboard`** (`page.tsx`) — calls `getDashboardStats()` +
  `getDemoMode()` in parallel, then renders:
  - `TopBar` (title + the "Demo data" on/off switch, described below).
  - `StatsCards` — 7 KPI tiles: Total Stores, Active Stores, Inactive
    Stores, Installed (7d), Total Products, Total Orders, Audits Completed.
  - `InstallsChart` — installs‑per‑day for the last 30 days.
  - `CountryChart` / `PlanChart` — top‑10 breakdown by store country /
    Shopify plan.
  - "Recent Installs" list (last 10 stores, newest first, linking to each
    store's detail page) and `ActivityTimeline` (last 20 activity events
    across **all** stores).
- **`/dashboard/stores`** (`page.tsx` + `store-table.tsx`) — a searchable
  (`shopName`/`shopDomain`/`email`, case‑insensitive), filterable
  (all/active/inactive), paginated (20/page) table of every store, driven
  entirely by URL search params (`?search=&status=&page=`) so it's
  shareable/bookmarkable and doesn't need client state for the list itself.
- **`/dashboard/stores/[domain]`** (`page.tsx` + `store-detail.tsx`) — full
  detail for one store by its `shopDomain`: a left info card (name, domain
  linking out to that shop's `/admin`, email, address, timezone/currency/
  locale, Shopify plan/product/order counts, shop‑created/installed/
  uninstalled/last‑synced dates, current OAuth scope) and a right‑hand
  tabbed panel switching between **Configuration** (`config-viewer.tsx` —
  on/off badges for the app + all 3 scripts + debug mode, script titles
  list, metaobject id, last‑synced timestamp) and **Activity Timeline**
  (`activity-timeline.tsx` — every logged event for that store specifically,
  each with an expandable "Show details" `<pre>` of its raw metadata JSON,
  color‑coded by event type via `eventTypeColor`/`eventTypeLabel` in
  `lib/utils.ts`, relative + absolute timestamps).
- **`/dashboard/settings`** (`page.tsx` + `settings-client.tsx`) — three
  cards for the *currently logged‑in internal admin user*: the Demo Data
  toggle (duplicated here and in the TopBar for convenience), a
  Profile form (name/email via `PATCH`‑style POST to
  `/api/auth/update-profile`; blocks changing to an email already used by
  a *different* admin user), and a Change Password form (requires the
  current password, ≥8 chars for the new one).

### 4.5 The "Demo Mode" system

A notable, deliberately‑engineered feature: the admin panel can show
**~32 realistic fake stores** (`src/lib/dummy-data.ts`) alongside real
database rows, purely for demoing the panel to stakeholders before enough
real merchants have installed the app, **without ever writing fake data
into the database**.

- **`data-source.ts`** — a legacy static env flag (`SHOW_DUMMY_DATA`),
  now only used as the *first‑ever‑visit default* before a cookie exists.
- **`demo-mode.ts`** — the live mechanism: a `demo_mode` cookie (`"on"`/
  `"off"`, 1‑year expiry, not security‑sensitive) read/written via
  `getDemoMode()`/`setDemoMode()`. `POST /api/demo` flips it, and every
  page that calls `getDashboardStats`/`getStores`/`getStoreByDomain`
  re‑checks it per‑request — no restart or redeploy needed to toggle.
- **`queries.ts`** — when demo mode is on, real Postgres rows and the
  in‑memory dummy rows are **merged in application memory** (never written
  back), then the exact same filtering/sorting/pagination logic is applied
  uniformly across the combined list, so the UI can't tell (and doesn't
  need to know) which rows are real vs. demo. A `Badge` ("Demo mode") shows
  in the `TopBar` whenever it's on, and looking up a store by domain checks
  real data first and only falls back to a dummy store if no real store
  matches (so a real store domain always wins if it happens to collide).

### 4.6 Data access layer (`src/lib/`)

- **`prisma.ts`** — this panel's own singleton Prisma client (separate
  instance from the Shopify app's, but pointed at the same
  `DATABASE_URL`).
- **`queries.ts`** — all read queries used by every page:
  `getDashboardStats()` (parallel‑fetches all stores + recent activity,
  computes every KPI/aggregate in application code, including
  `buildInstallsByDay`/`buildCountByKey` helpers from `dummy-data.ts` used
  even for the real‑data path), `getStores(options)` (search/filter/
  paginate), `getStoreByDomain(domain)` (single store + up to 100 recent
  activities).
- **`types.ts`** — shared structural types (`StoreSummary`, `StoreConfig`,
  `StoreWithConfigs`, `StoreWithDetails`, `DashboardStats`, etc.) that both
  the real Prisma results and the synthetic dummy‑data objects are shaped
  to conform to, so UI components don't care which source they came from.
- **`utils.ts`** — `formatDate`, `formatRelativeTime`, `eventTypeLabel`/
  `eventTypeColor` (maps raw `eventType` strings like `installed`,
  `uninstalled`, `config_changed`, `scope_updated` to human labels + badge
  colors), and `cn()` (the standard `clsx` + tailwind‑merge helper used
  everywhere for conditional class names).

---

## 5. End‑to‑end flows (how the two modules and the DB interact)

### 5.1 Merchant installs the app

1. Shopify OAuth completes → `auth.$.jsx` loader fires →
   `authenticate.admin` creates/loads the offline session (stored in
   Postgres `Session` table by `PrismaSessionStorage`) → `ensureConfig`
   creates the `$app:script_injector_config` metaobject if this is the very
   first install.
2. Merchant is redirected into `/app` → `app._index.jsx` loader runs:
   fetches live shop data from Shopify, **creates the `Store` row** in
   Postgres (this is the exact moment the merchant "appears" in the admin
   panel), syncs the metaobject config into `StoreConfig`, and logs an
   `installed` `StoreActivity` row.
3. From this point on, the merchant is on **Step 1** of the wizard with the
   app toggle off.

### 5.2 Merchant enables the app (the core audit flow)

1. Merchant flips the Step‑1 switch → `intent: "toggle-app"` action →
   metaobject updated (`appEnabled=true`, all 3 scripts default to on) →
   `resetAudit` clears prior audit state → `startHiddenAudit()` fires a
   background async job and returns immediately.
2. In the background: `discoverPages` finds Home/PLP/PDP → `runHiddenAudit`
   launches headless Chromium, injects the audit script, walks all three
   pages (waiting ~40s per page for third‑party content to settle),
   collects the script‑pattern list and off‑screen‑selector list.
3. While this runs, the dashboard polls `/api/audit/status` every 3s,
   updating a progress bar and countdown; `StoreConfig.auditPageIndex`/
   `auditTotalPages` are updated once a second by the audit's own progress
   poller.
4. On completion, `saveAuditReport()` writes the final arrays + flags to
   `StoreConfig`, stores the raw report on `PerformanceScript.auditScript`,
   and appends an `AuditLog` row. The next dashboard poll sees
   `complete: true` and **auto‑advances the wizard to Step 2**.
5. Merchant reviews/edits the audit‑derived arrays in Step 2's nested
   Step‑3 panel, toggling individual fields and hitting each box's own
   Save button — all DB‑only writes via `updateAuditArrays`/
   `updateAuditFieldToggle`.
6. Each of these actions also calls `safeLogActivity()`, so every one of
   these merchant actions shows up, per‑store, in the admin panel's
   Activity Timeline.

### 5.3 A real customer visits the storefront

1. The theme renders the `performance_scripts.liquid` app‑embed block
   (assuming the merchant enabled it in the theme editor), which requests
   `/apps/my-first-custom-app?v=<timestamp>` — cache‑busted per page load.
2. Shopify's App Proxy verifies the request and forwards it to this app's
   proxy target, which today resolves to **`api.script.jsx`**.
3. `api.script.jsx` authenticates the proxy request, reads
   `appEnabled`/`debugMode` from the metaobject for that shop, and returns
   the current (dummy‑placeholder) bundle. See §9 for why this is not yet
   the real optimization logic in production, even though that logic
   (`api.storefront-scripts.jsx` + `generateDeferredScript`) is fully built.

### 5.4 Merchant uninstalls the app

1. Shopify fires `app/uninstalled` → `Store.isActive=false` +
   `uninstalledAt` set, an `uninstalled` activity logged (store now shows
   as "Inactive" everywhere in the admin panel, but its history is
   preserved, not deleted), config metaobject deleted if still reachable,
   Shopify `Session` rows for that shop deleted.
2. `api.storefront-scripts.jsx`'s own inactive‑store check
   (`store.isActive === false`) means even a stale/cached theme embed on an
   uninstalled store's storefront would get served the no‑op bundle rather
   than stale optimization logic — a defense‑in‑depth safety net.

### 5.5 Internal team reviews the fleet

1. Internal admin logs into the separate admin panel (its own auth, no
   relationship to Shopify).
2. `/dashboard` reads `getDashboardStats()` straight from the **same**
   Postgres tables the Shopify app writes to — no sync job, no API call
   between the two apps, no message queue; it's just two apps sharing one
   database.
3. Drilling into a store (`/dashboard/stores/[domain]`) shows exactly the
   `StoreConfig` row and `StoreActivity` log the Shopify app produced for
   that merchant in real time.

---

## 6. The shared database — full schema reference

Both `prisma/schema.prisma` (Shopify app) and `admin-panel/prisma/schema.prisma`
(admin panel) point at the **same** `DATABASE_URL` Postgres instance, but —
important — **they are two independently‑maintained copies of the schema
file**, not one shared package. See §9 for the drift this has already caused.

| Model | Written by | Read by | Purpose |
|---|---|---|---|
| **`Session`** | Shopify app only (`PrismaSessionStorage`) | Shopify app only | Shopify OAuth session storage (online + offline tokens, scopes, user info). Standard shape required by `@shopify/shopify-app-session-storage-prisma`. |
| **`Store`** | Shopify app (`upsertStore`, `markStoreUninstalled`, `updateStoreScope`) | Both apps | One row per shop that has ever installed the app: Shopify identifiers, full address/locale/currency, plan name, product/order counts, install/uninstall timestamps, `isActive`, current OAuth scope, `lastSyncedAt`. This is the row the admin panel's entire Stores UI is built on. |
| **`StoreConfig`** | Shopify app only | Both apps | 1:1 with `Store`. Script on/off flags, titles, debug mode, the three audit arrays + their enabled flags + their preserved snapshots, the storefront password, the full hidden‑audit lifecycle state, and the metaobject id mirror. This is what `config-viewer.tsx` renders in the admin panel. |
| **`StoreActivity`** | Shopify app only (`logActivity`) | Both apps | Append‑only event log per store (`installed`, `uninstalled`, `config_changed`, `scope_updated`, etc.) with freeform JSON `metadata`. Powers both the per‑store timeline and the global "Recent Activity" feed. |
| **`AdminUser`** | Admin panel only (`createAdminUser`, `updateAdminProfile`, `changeAdminPassword`) | Admin panel only | Internal team login accounts for the admin panel (bcrypt‑hashed passwords, `role` field currently only ever set to `"admin"`). **Completely unrelated to Shopify merchants.** |
| **`PerformanceScript`** | Shopify app (`saveAuditReport`, `api.save-performance-scripts.jsx`) | Shopify app only | 1:1 with `Store`. Stores the raw audit report JSON and free‑text `auditScript`/`deferScript`/`hiddenCss` fields — effectively a debug/history artifact, not read by any current UI. |
| **`AppTracking`** | *(present in schema, no code writes to it)* | — | Defined in the main app's schema only (not present in the admin panel's schema at all) but no current code path creates/updates rows here — looks like an earlier tracking model superseded by `Store`/`StoreActivity`. |
| **`AuditLog`** | Shopify app (`saveAuditReport`, `api.audit.start.jsx`'s failure path) | Shopify app only | Free‑form append‑only log of every audit run (success or failure), independent of the "live" `StoreConfig` audit fields — a permanent history trail. Also **absent from the admin panel's schema**. |

---

## 7. Environment variables this project expects

**Shopify app (`/` root):**
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`
- `SHOP_CUSTOM_DOMAIN` (optional)
- `DATABASE_URL` (Postgres connection string)
- `CHROMIUM_PATH` (optional override for Playwright's Chromium binary path
  — set to `/usr/bin/chromium-browser` in the Dockerfile, which installs
  Alpine's system Chromium instead of downloading Playwright's own binary,
  hence `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`)

**Admin panel (`/admin-panel`):**
- `DATABASE_URL` (same Postgres instance as above)
- `ADMIN_SESSION_PASSWORD` (≥32 chars; app **refuses to boot correctly**
  without this in production)
- `SHOW_DUMMY_DATA` (optional legacy default for demo mode's first visit)
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` (optional,
  only used by `prisma/seed.ts`)

---

## 8. Local development & deployment

- **Local Postgres**: `docker-compose.yml` spins up a single
  `postgres:16-alpine` container (`performance-app-db`, db `performance_app`,
  user `admin`) with `init.sql` just enabling the `uuid-ossp` extension.
  Both apps' `DATABASE_URL`s should point at this during local dev.
- **Shopify app dev loop**: `npm run dev` → `shopify app dev` (Shopify CLI
  tunnels a local URL, manages `.env`, and can push the `shopify.app.toml`
  config including the metaobject definitions). `shopify.web.toml`'s
  `predev`/`dev` commands additionally run `prisma generate` and
  `prisma migrate deploy` automatically before the dev server starts.
- **Shopify app production**: single multi‑stage‑free `Dockerfile`
  (Node 20 Alpine + system Chromium + the Playwright‑skip‑download env
  vars) → `npm run docker-start` → `prisma generate && prisma migrate
  deploy && react-router-serve ./build/server/index.js`.
- **Admin panel dev/production**: standard Next.js (`next dev` /
  `next build` && `next start`) — it has **no Dockerfile in this repo**,
  implying it's deployed separately (its own container, or a platform like
  Vercel) from the Shopify app.
- **Extensions**: the theme app extension is deployed via `shopify app
  deploy` (part of the Shopify CLI app package), not via the Node build at
  all.

---

## 9. Known inconsistencies / half‑finished states (as of this snapshot)

These are not bugs to silently "fix" in documentation — they're accurately
describing the **current, real** state of the code so future work starts
from truth rather than from an idealized description:

1. **The live storefront script is still the placeholder.** The theme
   embed block (`performance_scripts.liquid`) requests
   `/apps/my-first-custom-app`, which resolves to **`api.script.jsx`** —
   the file whose own comments say it injects two no‑op dummy scripts and
   one no‑op style block "to exercise the delivery path" and that "real
   logic is added before launch." The actual, fully‑implemented
   interaction‑gated defer/hide logic lives in **`api.storefront-scripts.jsx`
   + `generateDeferredScript()`** and is production‑ready, but nothing in
   the extension currently points at it. Wiring the Liquid block (or
   `api.script.jsx`) to call/proxy into `api.storefront-scripts.jsx`'s
   logic is the remaining step to make the optimization live for real
   customers.

2. **`PREDEFINED_SCRIPTS` is an empty array.** `app/lib/scripts.ts` defines
   two dummy script bodies (`SCRIPT_1_DUMMY`, `SCRIPT_2_DUMMY`) but exports
   `export const PREDEFINED_SCRIPTS: PredefinedScript[] = [];` — meaning
   `Step2Configure.jsx`'s `PREDEFINED_SCRIPTS.map(...)` currently renders
   **zero script toggle rows** in Step 2 today, even though the
   `script1Enabled/2/3` state, the metaobject fields, and
   `api.step-3.jsx`'s endpoint (which maps over the same empty array) all
   still fully exist and expect 3 entries.

3. **The two Prisma schemas have drifted.** The root
   `prisma/schema.prisma` (used by the Shopify app) has **more** models
   (`AppTracking`, `AuditLog`) and **more `StoreConfig` columns** (the
   entire hidden‑audit lifecycle: `auditRunning`, `auditFailed`,
   `auditError`, `auditPageIndex`, `auditTotalPages`, `storefrontPassword`,
   the enabled/preserved toggle columns, `PerformanceScript`) than
   `admin-panel/prisma/schema.prisma`. The admin panel's own migration
   history literally includes one named
   `20260902073700_drop_audit_columns`, confirming this divergence was
   intentional at some point but has continued to widen since. In
   practice this means: (a) the admin panel's `ConfigViewer` component
   only ever displays the handful of fields both schemas agree on, and
   (b) anyone regenerating the admin panel's Prisma client should NOT
   assume it has access to the audit‑lifecycle columns — they're `main
   app`‑schema‑only right now.

4. **No committed migration history for the main app's schema.** Unlike
   the admin panel (which has a proper `admin-panel/prisma/migrations/`
   folder), the root `prisma/` directory contains only `schema.prisma`
   and a stray `dev.sqlite` file — no `migrations/` folder at all, even
   though `package.json`'s `setup` script runs `prisma migrate deploy`
   (which requires a migrations folder to do anything). In its current
   state, `prisma migrate deploy` for the main app would be a no‑op;
   schema changes are likely being applied via `prisma db push` or
   directly against the shared database instead. The leftover
   `dev.sqlite` file is a harmless artifact from an earlier point when the
   project used SQLite for local dev, before the schema's `datasource`
   block was switched to `provider = "postgresql"`.

5. **`Desing_plan.md`'s original spec described a 3‑step wizard**
   ("Start" → "Preview" → "Finish") with a 3‑circle stepper. The shipped
   product is a 2‑step wizard (`WizardProgress.jsx`'s
   `STEP_LABELS = ["Start", "Scripts + Titles"]`), with the old "Step 3"
   content (the audit‑results editor) nested inside Step 2 via
   `Step3Titles.jsx`. This file (`PROJECT_FLOW.md`) reflects the shipped
   2‑step reality, not the original design brief.

---

## 10. Quick reference — "where do I change X?"

| I want to change... | File(s) |
|---|---|
| The Step‑1 activation screen's copy/layout | `app/components/Step1Activate.jsx` |
| How many wizard steps exist / their labels | `app/components/WizardProgress.jsx` (labels), `app/routes/app._index.jsx` (`maxStep` logic) |
| What happens when the app toggle flips on/off | `app/routes/app._index.jsx` (`action`, `intent: "toggle-app"`) |
| The hidden audit's page‑selection heuristics | `app/lib/audit.server.ts` → `discoverPages` |
| The hidden audit's DOM analysis logic itself | `app/lib/audit-script.ts` (do not casually edit — it's verbatim by design; comments explain why) |
| How long the audit waits per page | `WAIT_MS` inside `AUDIT_SCRIPT` in `audit-script.ts` (currently 40000ms) |
| The real storefront optimization bundle | `app/lib/script-generator.js` → `generateDeferredScript` |
| Wiring the theme embed to the real bundle (see Known Issue #1) | `extensions/script-injector/blocks/performance_scripts.liquid` + either point it at `api.storefront-scripts.jsx` or move that logic into `api.script.jsx` |
| Which Shopify scopes/webhooks/metaobject fields exist | `shopify.app.toml` |
| The shared Postgres schema (Shopify app side) | `prisma/schema.prisma` |
| The shared Postgres schema (admin panel side — remember §9.3!) | `admin-panel/prisma/schema.prisma` |
| Admin panel login/session behavior | `admin-panel/src/lib/auth.ts`, `admin-panel/src/middleware.ts` |
| Admin panel dashboard KPIs/charts | `admin-panel/src/lib/queries.ts`, `admin-panel/src/components/*-chart.tsx`, `stats-cards.tsx` |
| Admin panel demo/dummy data | `admin-panel/src/lib/dummy-data.ts`, `demo-mode.ts`, `data-source.ts` |
