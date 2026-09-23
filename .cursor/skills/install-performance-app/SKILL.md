---
name: install-performance-app
description: >-
  Clone, boot, verify, and install the PagePulse Performance Shopify app on a
  chosen store. Use when the user says /install-performance-app, "install
  performance app", "start pagepulse", or asks to connect this repo to a store.
disable-model-invocation: true
---

# Install Performance App

**Canonical copy for git clones:** `PROJECT_FLOW.md` **§16** (plus
dashboard speed already-done notes in **§7.0**). If this skill and
that file disagree, update **both**.

This workspace is a **clone of shipped PagePulse source**, run with
`shopify app dev` against a **new destore that did not have the app**.
It is **not** the live Brainvire deployment
(`pagepulsespeed.node.brainvire.dev`). First install = empty local
Postgres, no embed, no metaobject instance until OAuth + dashboard.

Bring **this clone** to a verified running state on the named destore.
Do not tell the user it is ready until the Done checklist at the bottom is all true.

Repo: `https://github.com/rishabhpatel-rp/performance-improvement-app.git`
Default config: `pagepulse` (`shopify.app.pagepulse.toml`)
Default app org: **Brainvire** (`129007517`)
App client ID: `20ab28b1c9809df789897f44095a86cd`
App proxy: `/apps/performance-scripts` → `/api/storefront-scripts`
Local DB: `postgresql://admin:devpassword123@localhost:5432/performance_app?schema=public`
Playwright browsers: `~/.cache/ms-playwright` (never `/tmp/cursor-sandbox-cache`)

## 1. Collect required details

Ask **only** for what is missing. Do not start until store domain is known.

| Detail | Required | How to get it |
|---|---|---|
| Store domain | **Yes** | `*.myshopify.com`, or parse `admin.shopify.com/store/<subdomain>` → `<subdomain>.myshopify.com` |
| Storefront password | Yes if the store is password-protected | CLI `--store-password` + later storefront unlock / audit login |
| App config | No | Default `pagepulse`. Use `shopify.app.toml` only if the user names that app |
| Workspace | No | Current workspace. If empty, clone into it |

If the user already gave store + password in this chat, reuse them. Do not invent a store.

```
Need two things to install:
1. Store domain (or admin URL), e.g. your-store.myshopify.com
2. Storefront password (dev-store password page), if it has one
```

## 2. Org check (before `app dev`)

```bash
shopify organization list --no-color
shopify store list --organization-id 129007517 --no-color
```

PagePulse lives in **Brainvire**. Shopify CLI will not attach it to a store in another org (this failed for `dev-test-store-vohzxcoa` in "Rishabh Custom Store").

If the store is not in Brainvire:

1. Find it in the other orgs.
2. **Stop.** Do not retry `app dev` against that store.
3. Ask: Brainvire store, new app in the store's org, or move the store.

Known Brainvire store that worked: `rishabh-dev-store-mdqu0epm.myshopify.com` (Rishabh-Dev-Store).

## 3. Boot the repo

Skip steps that are already done.

1. If `package.json` is missing: `git clone https://github.com/rishabhpatel-rp/performance-improvement-app.git .`
2. Node must be `>=20.19 <22 || >=22.12`. If `node_modules` is missing: `npm ci` (network).
3. If `.env` has no `DATABASE_URL`, write **only** that line using the local DB URL above. Do not invent `SHOPIFY_API_KEY` / secret — CLI writes those.
4. Confirm Postgres on `localhost:5432` (`npx prisma migrate deploy`). If unreachable:
   - `docker-compose up -d` from the repo root (user may need docker group / sudo).
   - Ask the user to start Postgres if Docker is blocked. Do not change `DATABASE_URL` without asking.
5. `npx prisma generate && npx prisma migrate deploy`

## 4. Playwright (audits will fail without this)

Cursor injects `PLAYWRIGHT_BROWSERS_PATH=/tmp/cursor-sandbox-cache/...` which is empty. The real Chromium is already at `~/.cache/ms-playwright/chromium_headless_shell-1234/...`.

**Always:**

1. Confirm `shopify.web.toml` `dev` command unsets `PLAYWRIGHT_BROWSERS_PATH` on both `prisma migrate deploy` and `react-router dev`.
2. Start CLI with `env -u PLAYWRIGHT_BROWSERS_PATH`.
3. After the app is up, confirm the `react-router dev` child has **no** `PLAYWRIGHT_BROWSERS_PATH`.
4. Smoke-test launch (must print `playwright launch ok`):

```bash
env -u PLAYWRIGHT_BROWSERS_PATH node --input-type=module -e "
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
console.log('playwright launch ok', b.version());
await b.close();
"
```

Do **not** `npx playwright install` into the sandbox cache. If the default cache is missing the binary, install with `env -u PLAYWRIGHT_BROWSERS_PATH npx playwright install chromium`.

## 5. Start (or recycle) the app

Prefix Shopify CLI you run yourself:

```bash
SHOPIFY_CLI_AGENT_INFO="n:cursor|v:none|p:none|m:<model>" \
SHOPIFY_CLI_AGENT_IDS="s:<conversation-id>" \
shopify ...
```

If `shopify app dev` is already running for this store, **do not blindly reuse it**. Check the printed `trycloudflare.com` host still answers. If DNS fails or storefront proxy is 500, kill that process and start a new one.

From the repo root, with `all` permissions:

```bash
env -u PLAYWRIGHT_BROWSERS_PATH shopify app dev \
  --config pagepulse \
  --store <store>.myshopify.com \
  --store-password '<password>' \
  --skip-dependencies-installation \
  --no-color
```

Omit `--store-password` only when the user said there is no password.

Background it. Wait for `Preview URL` and `Ready, watching for changes`.

Benign noise (ignore):

- `No route matches URL "/json/version"`
- CLI sending `APP_UNINSTALLED` on first boot
- React Router v8 future-flag warnings
- Vite `chromium-bidi` client-dep warnings during Playwright import

## 6. Storefront script contract (do not regress)

Theme embed `extensions/script-injector/blocks/performance-loader.liquid` does `fetch("/apps/performance-scripts")` and expects JSON:

```json
{ "success": true, "data": { "auditScript": "<js>", "hiddenCss": "<css>" } }
```

`app/routes/api.storefront-scripts.jsx` **must** compile from `StoreConfig`:

- `auditDeferArray` / `staticDeferDefaults` / `auditHideSelectors`
- respect each field's `*Enabled` toggle
- `generateDeferredScript(deferArray, staticDefer)` — both arguments are **string arrays**
- build hide CSS from hide selectors

**Never** pass `PerformanceScript.auditScript` into `generateDeferredScript`. That column is the raw audit report JSON (`saveAuditReport` writes `JSON.stringify(report)`). Feeding it in produces a huge broken bundle or a 500.

If this file has drifted back to `include: { performanceScript: true }`, fix it before calling the app ready.

## 7. Mandatory verification (never skip)

Unlock the password page first (need `authenticity_token` from GET `/password`, then POST password). A request without the digest cookie gets a theme HTML 500/302, which is **not** an app bug.

Then:

```bash
# 1) Tunnel host from CLI "Using URL:" must be reachable from Shopify's side.
#    Local DNS to trycloudflare.com can fail even when the storefront proxy works.
#    Trust the storefront proxy result below over local curl of the tunnel.

# 2) Storefront app proxy — this is the live-site check
curl -sS -b <store-cookies> -o /tmp/ps.json -w "%{http_code} %{content_type}\n" \
  "https://<subdomain>.myshopify.com/apps/performance-scripts"
```

Pass only if:

- HTTP **200**
- `Content-Type` includes `application/json`
- body has `"success":true` and `data.auditScript` (empty script is OK if the app toggle is off or no audit yet)
- body is **not** Shopify HTML containing `There was an error in the third-party application`

If the merchant already ran an audit and the app is ON, `auditScript` should be non-empty obfuscated JS and `hiddenCss` should contain `html:not(.interacted)`.

Also confirm:

- Preview URL opens the embedded app
- Theme editor deep link exists so they can enable **Performance Script Loader** in App embeds if it is off

## 8. Reply

Give:

- **Install / open app:** `https://admin.shopify.com/store/<subdomain>/apps/20ab28b1c9809df789897f44095a86cd?dev-console=show`
- Theme editor link from CLI
- Local URL
- Storefront: `https://<subdomain>.myshopify.com/`
- What you verified (proxy status code + JSON `success`)

Tell them to click **Install app** if Shopify prompts, then enable the app embed if scripts still do not load. Do not paste GraphiQL keys or store passwords.

## Failure shortcuts

| Error | What to do |
|---|---|
| Store not found in organization Brainvire | Org mismatch — §2. Do not retry the same command. |
| Can't reach database `localhost:5432` | Start Postgres / ask for Docker. Do not invent a new `DATABASE_URL`. |
| Auth / login prompt | User runs `shopify auth login` in a real terminal, then rerun. |
| Playwright executable under `/tmp/cursor-sandbox-cache` | Restart with `env -u PLAYWRIGHT_BROWSERS_PATH`. Confirm child env. |
| `/apps/performance-scripts` 500 / "error in the third-party application" | Tunnel dead or app unreachable. Restart `shopify app dev`. Re-run §7. |
| Proxy 200 HTML instead of JSON | Password wall or proxy not applied. Unlock storefront; confirm app is installed and embed is on. |
| Proxy 200 JSON but `auditScript` empty while audit finished | Check `StoreConfig.appEnabled` and enabled toggles. Do not read `PerformanceScript`. |
| `generateDeferredScript` fed a JSON string / full report | Fix `api.storefront-scripts.jsx` — §6. |
| Production `pagepulsespeed.node.brainvire.dev` 502 | Local `app dev` does not fix hosted prod. Say so; only the tunnel-backed storefront is in scope. |

## Done checklist

Copy and tick before you stop:

```
- [ ] Store is in Brainvire (or user approved a different plan)
- [ ] DATABASE_URL works; migrations applied
- [ ] PLAYWRIGHT_BROWSERS_PATH unset on react-router; chromium launches
- [ ] shopify app dev Ready; Preview URL printed
- [ ] api.storefront-scripts.jsx compiles from StoreConfig arrays
- [ ] GET /apps/performance-scripts → 200 application/json success:true
- [ ] Dashboard loader is parallel + 3s timeout (PROJECT_FLOW §7.0); do not re-serialize
```


env -u PLAYWRIGHT_BROWSERS_PATH shopify app dev \
  --config pagepulse \
  --store rishabh-dev-store-mdqu0epm.myshopify.com \
  --store-password 1 \
  --skip-dependencies-installation