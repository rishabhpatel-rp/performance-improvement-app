# Admin store script config — implementation plan

> **For agentic workers:** Implement phase-by-phase; do not ship Phase N+1 until Phase N acceptance checks pass.  
> **Status:** Plan only (partial spike code exists on branch — treat as prototype, not production).

**Goal:** Let internal admins open any installed store in the admin panel, view the **same script-list data** merchants see in PagePulse, edit it safely, and rebuild that store’s storefront inject script (DB + Shopify metafield) without using the embedded app.

**Architecture:** Admin panel remains a **read-mostly Next.js app** on shared Postgres. All **writes + `rebuildPerformanceScript` + `syncScriptMetafield`** run on the **main Remix app** via a single internal HTTP API that reuses existing `dashboard-actions-step3` / `updateAuditArrays` logic — no duplicated business rules in admin.

**Tech stack:** Next.js 15 admin-panel, React Router 7 PagePulse app, Prisma 6, Postgres, iron-session admin auth, `ADMIN_INTERNAL_SECRET` bearer between apps.

---

## Global constraints

- **Never** expose `storefrontPassword` or offline `accessToken` to the browser (admin store detail must use an explicit Prisma `select` allowlist).
- **Never** claim a save worked without: DB row updated, `PerformanceScript.deferScript` / `scriptHash` changed (or documented empty when app off), and metafield sync attempted (log `metafieldSyncedAt`).
- Admin panel: **`prisma generate` only** against shared DB (no admin-only migrations); schema must stay in sync with root `prisma/schema.prisma` for models admin reads.
- Production: `SHOW_DUMMY_DATA` must be **false**; demo cookie off.
- Obfuscation: production builds keep `SKIP_JAVASCRIPT_OBFUSCATION = false` in `script-generator.js`.
- Infrastructure: `PAGEPULSE_APP_URL`, `ADMIN_INTERNAL_SECRET` — confirm with ops before deploy (do not guess production URLs).

---

## 0. Problem statement (why “data doesn’t look perfect” today)

### 0.1 Three layers of truth (merchant vs storefront vs admin)

| Layer | What it holds | Used when building storefront JS |
|-------|----------------|----------------------------------|
| **Union columns** | `auditDeferArray`, `auditHideSelectors`, `firstUserDelayScripts`, `staticDeferDefaults` | `rebuildPerformanceScript` → `generateDeferredScript` **directly** (union lists + delays) |
| **Template buckets** | `auditDeferGlobal`, `auditDeferHome`, … ×4 scopes ×4 list types (+ per-scope delay ms) | Merchant **UI** via `templateConfigFromRow`; saves recompute **union** columns (`handleSaveAuditArrays` in `dashboard-actions-step3.server.js`) |
| **Per-page audit** | `AuditLog.audit_data` (completed audit) | `readPerPageAuditData` → `pageVariants` + `baseScripts` in generator |

**Admin spike (2026-11)** only edits **four union textareas**. That is enough to change **storefront behaviour** (rebuild reads unions), but it will **not match** what merchants see if:

- Template bucket columns are populated (audit heal) while unions look different in UI.
- A completed audit supplies **per-page variants** — removing `xyz.js` from union may not remove it from a PDP variant until audit data or buckets are updated.

### 0.2 Write-path drift in main app (must fix in Phase 1)

- `dashboard-actions-step3.server.js` → `handleSaveAuditArrays` builds a patch with **16 template list keys** + recomputed unions.
- **`store-sync.server.ts` → `updateAuditArrays`** only persists a **fixed set** of union/delay keys (template columns in `patch` are **ignored**).
- **`store-sync-audit.server.ts` → `updateAuditArrays`** uses `Object.fromEntries(patch)` (writes all keys).

**Decision required:** Pick **one** `updateAuditArrays` implementation (recommend: audit version + typed allowlist of keys) and **one import path** for all callers. Until then, merchant template saves and admin saves can disagree with DB reality.

### 0.3 Admin panel schema / Prisma drift

Root `prisma/schema.prisma` includes template bucket columns and `PerformanceScript`. `admin-panel/prisma/schema.prisma` comment still warns of historical drift. Deployed admin must run `npx prisma generate` from **updated** admin schema that includes every column the UI reads.

### 0.4 Prototype already in repo (inventory)

| Area | Files | Maturity |
|------|--------|----------|
| Internal API | `app/routes/api.admin.store-config.ts`, `app/lib/admin-internal-auth.server.ts` | Prototype — calls `updateAuditArrays` with union-only patch |
| Admin proxy | `admin-panel/src/app/api/stores/[domain]/store-config/route.ts` | Prototype |
| UI | `store-array-editor.tsx`, `store-detail.tsx` tabs | Prototype — 4 union boxes only |
| Display fixes | `audit-array-fields.ts`, `queries.ts` `STORE_DETAIL_CONFIG_SELECT` | Partial — local only until pushed |

---

## 1. Target behaviour (acceptance definition)

### 1.1 Personas

- **Admin operator:** Edits script lists for store X; expects storefront to match within cache TTL (metafield + proxy ETag).
- **Merchant:** Continues using PagePulse; admin edits must not corrupt buckets/unions/per-page semantics.

### 1.2 Functional requirements

| ID | Requirement |
|----|-------------|
| A1 | Store detail loads **one** `StoreConfig` row (latest `updatedAt`) without leaking secrets. |
| A2 | **Script configuration** tab shows data equivalent to merchant loader: `templateConfigFromRow` buckets (Global/Home/Collection/Product) for defer, hide, first-visit delay, every-load delay, plus list-level toggles and preserved snapshots. |
| A3 | Optional **Union summary** section (read-only or editable) showing computed `auditDeferArray` etc. — must match `unionTemplateLists` after any bucket edit. |
| A4 | **Remove script** `xyz.js` from correct scope (e.g. Global defer list) → save → `rebuildPerformanceScript` → shopper loads `xyz.js` normally on pages that were gated only via that list. |
| A5 | **Per-page audit** section (read-only): last completed `AuditLog` summary — variant count, base script count — so operators know union edits may not be sufficient. |
| A6 | **Activity** log entry on each admin save: `config_changed` with `metadata.source = "admin-panel"`. |
| A7 | Save failures show actionable errors (401 secret, 404 store, 503 missing `PAGEPULSE_APP_URL`, Shopify session missing for metafield sync). |
| A8 | `viewer` role: read-only; `admin` role: edit (use existing `requireRole`). |

### 1.3 Non-goals (v1)

- Bulk edit all stores in one form.
- Re-running audits from admin.
- Editing raw `deferScript` source.
- Metaobject write-back (DB-authoritative for arrays).

---

## 2. Recommended architecture

```
┌─────────────────────┐     POST /api/stores/:domain/store-config     ┌──────────────────────────┐
│  Admin panel (Next) │ ────────────────────────────────────────────►│  Admin BFF route         │
│  StoreArray UI      │     iron-session admin cookie                 │  requireRole("admin")    │
└─────────────────────┘                                               └────────────┬─────────────┘
                                                                                      │ Bearer secret
                                                                                      ▼
                                                                        ┌──────────────────────────┐
                                                                        │  PagePulse Remix app      │
                                                                        │  POST /api/admin/store-config │
                                                                        │  → handleSaveAuditArrays     │
                                                                        │  → handleToggleAuditField    │
                                                                        │  → handleScriptTokenAction?  │
                                                                        │  → rebuildPerformanceScript  │
                                                                        │  → syncScriptMetafield       │
                                                                        └──────────────────────────┘
```

**Key decision:** Internal API should call **`handleSaveAuditArrays` / `handleToggleAuditField`** from `dashboard-actions-step3.server.js` (pass `shopDomain` instead of `session.shop`), not a second validation path.

---

## 3. Phased implementation

### Phase 1 — Unify write path on main app (prerequisite)

**Outcome:** Any save from merchant or admin persists template buckets + unions consistently and rebuilds once.

| Task | Detail |
|------|--------|
| 1.1 | Audit all imports of `updateAuditArrays` (`store-sync.server` vs `store-sync-audit.server`). |
| 1.2 | Extend `AuditArrayPatch` (or `Record<string, unknown>` allowlist) to include `templateListFormKeys()` + `templateDelayFormKeys()` + hide bucket columns. |
| 1.3 | Implement **single** `updateAuditArrays`: `update: pickAllowedKeys(patch)` + rebuild + optional sync. |
| 1.4 | Add unit tests: saving `auditDeferHome` updates row and recomputed `auditDeferArray` when done via `handleSaveAuditArrays`. |
| 1.5 | Refactor `api.admin.store-config.ts` to invoke shared handlers (`save-audit-arrays`, `toggle-audit-field`, optional `script-token-action`). |

**Acceptance:** Run merchant save on template field in dev; verify DB columns `auditDeferProduct` etc. change; `rebuildPerformanceScript` hash changes.

---

### Phase 2 — Admin data loading (parity display)

**Outcome:** Store detail shows the same numbers/JSON as PagePulse dashboard loader.

| Task | Detail |
|------|--------|
| 2.1 | Sync `admin-panel/prisma/schema.prisma` **StoreConfig** + **PerformanceScript** + **AuditLog** (read-only) with root schema (script: copy models or documented sync checklist in CI). |
| 2.2 | `getStoreByDomain`: `configs: { select: STORE_DETAIL_CONFIG_SELECT }` including **all template bucket columns** + toggles/preserved + delays per scope. |
| 2.3 | Port or share **`template-script-config.ts`** logic into admin (preferred: small shared `packages/admin-config` or duplicate pure functions in `admin-panel/src/lib/template-script-config.ts` — file is pure TS, no Remix deps). |
| 2.4 | Server helper `buildTemplateConfigView(configRow)` → same shape as `templateConfigFromRow` + union lists. |
| 2.5 | Optional: loader endpoint `GET /api/admin/store-config?shop=` returning JSON view model (keeps heavy logic on Remix) — use if duplicating template logic in admin is undesirable. |

**Acceptance:** For one test shop, diff admin JSON vs merchant `finalConfig` from dashboard loader (union + `auditDeferGlobal` lengths).

---

### Phase 3 — Admin UI (match merchant capabilities)

**Outcome:** Operators edit buckets, not only unions.

| Task | Detail |
|------|--------|
| 3.1 | Replace prototype `store-array-editor` with **scope tabs**: Global / Home / Collection / Product (labels from `TEMPLATE_SCOPE_LABELS`). |
| 3.2 | Per scope, four textareas (defer, hide, first delay, every delay) + delay ms fields — mirror `templateListFormKeys` / `templateDelayFormKeys`. |
| 3.3 | Global list-level toggles (four `*Enabled` flags) — same semantics as `updateAuditFieldToggle`. |
| 3.4 | On save: POST full patch for that scope or whole form; server recomputes unions via existing `handleSaveAuditArrays` logic. |
| 3.5 | **Configuration** tab: keep summary toggles; add “Union (computed)” read-only lists. |
| 3.6 | **Audit** sub-panel: fetch latest `AuditLog` (`status: completed`) — show `pageVariants.length`, link to run merchant app for re-audit. |

**UX note:** Merchant also has **Step3Titles** four union boxes and **AuditReportPanel** token actions — v1 admin can skip token table UI and use JSON arrays; v1.1 can add “remove token from scope” buttons calling `handleScriptTokenAction`.

**Acceptance:** Remove `xyz.js` from Global defer in admin → verify in DB `auditDeferGlobal` and `auditDeferArray` → storefront network tab shows script not deferred.

---

### Phase 4 — Operations, security, deployment

| Task | Detail |
|------|--------|
| 4.1 | Document env: `ADMIN_INTERNAL_SECRET`, `PAGEPULSE_APP_URL` in root README + `admin-panel/.env.example`. |
| 4.2 | Network: admin server must reach PagePulse app URL (VPC / tunnel); rotate secret procedure. |
| 4.3 | Rate-limit admin save API (per shop / per admin user). |
| 4.4 | CI: `admin-panel` typecheck; main app test for internal route auth (401 without bearer). |
| 4.5 | Update `PROJECT_FLOW.md` §20 (admin capabilities) — remove “ConfigViewer cannot show audit arrays”. |

---

### Phase 5 — Verification matrix

| Case | Steps | Expected |
|------|--------|----------|
| V1 | Union-only store (no bucket columns) | Admin shows legacy data in Global fallback; save works |
| V2 | Post-audit bucket store | Admin shows per-scope lists; union summary matches |
| V3 | Toggle defer off | Active `[]`, preserved visible; storefront script empty gate |
| V4 | App disabled | Save still allowed? **Decision:** either block save or allow DB edit but rebuild returns empty script |
| V5 | No offline session | Rebuild succeeds; metafield sync fails — UI warning + `reconcileScriptMetafield` note |
| V6 | Per-page audit | Document that union edit may not affect variant `add` lists — link to audit JSON viewer |

---

## 4. File map (expected end state)

| File | Action |
|------|--------|
| `app/lib/store-sync.server.ts` | Unify `updateAuditArrays` with template keys |
| `app/lib/admin-store-config.server.ts` | **New** — `adminSaveAuditArrays(shopDomain, body)` wrapping step3 handlers |
| `app/routes/api.admin.store-config.ts` | Thin action router |
| `admin-panel/prisma/schema.prisma` | Sync with root StoreConfig + AuditLog read |
| `admin-panel/src/lib/template-script-config.ts` | Copy or import pure helpers |
| `admin-panel/src/components/store-template-editor.tsx` | **New** — scope tabs UI |
| `admin-panel/src/lib/queries.ts` | Expanded `STORE_DETAIL_CONFIG_SELECT` |
| `tests/admin-store-config.test.js` | Auth + patch allowlist |
| `tests/template-save-roundtrip.test.js` | Bucket → union → rebuild hash |

---

## 5. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Admin edits union but buckets stale | Always recompute unions on save; display buckets as primary UI |
| Per-page audit overrides union | Read-only audit section + doc; future: admin edit audit JSON (out of scope) |
| Two `updateAuditArrays` implementations | Phase 1 merge |
| Metafield out of sync | Surface `metafieldSyncedAt` + “Retry sync” button calling `reconcileScriptMetafield` via internal API |
| Schema drift | CI job: `diff` root vs admin prisma for shared models |

---

## 6. Effort estimate (rough)

| Phase | Effort |
|-------|--------|
| Phase 1 unify writes | 0.5–1 day |
| Phase 2 data loading | 0.5 day |
| Phase 3 UI (scope tabs) | 1–1.5 days |
| Phase 4 ops + tests | 0.5 day |
| **Total** | **~3–3.5 days** focused work |

---

## 7. Implementation order (updated per team)

**Phase 1 (done):** `app/lib/update-audit-config.server.ts` is the single writer;
`store-sync.server.ts` and admin save both re-export / call it (template + union keys).

**Shipped in repo (admin Phase 2/3 scope):**
- Template bucket columns in `admin-panel/prisma/schema.prisma` + `AuditLog` read model.
- Store detail **Script lists** tab: Global / Home / Collection / Product × 4 list types + delays.
- `adminSaveAuditArrays` on main app — writes all template columns + recomputed unions + rebuild.
- Union preview + latest audit summary on store detail.

**Deploy:** Both apps + `ADMIN_INTERNAL_SECRET` + `PAGEPULSE_APP_URL`; `npx prisma generate` in admin-panel.

---

## 8. Open questions for product / you

1. Should **viewer** role see arrays but not save, or hide Script tab entirely?  
2. When **app is disabled** on a store, should admin edits be blocked?  
3. Do you need **script token actions** (keep/defer/delay per row) in admin v1, or JSON arrays only?  
4. Should admin **sync unions only** for a quick “remove xyz everywhere” tool (calls `applyScopedTokenAction` across all scopes)?  
5. Production **PAGEPULSE_APP_URL** — confirm URL (tunnel vs internal service name).

---

*Plan author: implementation prep for admin store script editing. Revise this file when phases complete.*
