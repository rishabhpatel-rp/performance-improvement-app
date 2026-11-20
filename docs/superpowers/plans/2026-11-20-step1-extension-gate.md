# Step 1 Extension Gate + First Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Step 1 enable/password/URL controls until the theme app embed is enabled, require an explicit theme Save, then auto-enable and start the first audit once for eligible merchants.

**Architecture:** Hybrid UI gate in `Step1Activate` (theme draft → Save → Install → unlock on `embedStatus === "enabled"`) plus server `maybeFirstActivation` that enables the app and starts the first audit once, sticky via `StoreConfig.onboardingActivated`.

**Tech Stack:** React Router 7 merchant app, Prisma/`StoreConfig`, existing dashboard intents (`select-theme`, `toggle-app`, `save-storefront-password`), node:test.

**Spec:** `docs/superpowers/specs/2026-11-20-step1-extension-gate-design.md`

## Global Constraints

- Prefer POST paths for activation writes (no first-activation writes in GET loaders).
- `api.embed-status` stays read-only; client POSTs `maybe-first-activation` after embed is confirmed.
- Fail closed: `embedStatus` unknown/disabled does **not** unlock marketing/toggle/password/URLs.
- After unlock, PLP/PDP URL box is always visible (even with toggle OFF).
- Password box only when protected / password-block (existing rules).
- Do not auto-enable when `adminManaged` / merchant read-only.
- Existing `toggle-app` OFF→ON audit restart remains; first-activation is a separate one-shot path.
- Keep Remix and admin-panel `StoreConfig` schemas in sync (`npm run check:schema`).

## File map

| File                                                                  | Responsibility                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| `prisma/schema.prisma`                                                | Add `onboardingActivated`                                |
| `admin-panel/prisma/schema.prisma`                                    | Mirror field                                             |
| `prisma/migrations/20261120160000_onboarding_activated/migration.sql` | Column + backfill                                        |
| `app/lib/first-activation.ts`                                         | Pure eligibility helpers (unit-tested)                   |
| `app/lib/first-activation.server.ts`                                  | `maybeFirstActivation` side effects                      |
| `shared/action-schemas.ts`                                            | Register `maybe-first-activation` intent                 |
| `app/lib/dashboard-actions.server.ts`                                 | Dispatch new intent                                      |
| `app/lib/dashboard-actions-audit.server.ts`                           | Set flag on manual enable; optional thin wrapper handler |
| `app/lib/dashboard-actions-settings.server.ts`                        | Call helper after password save                          |
| `app/lib/dashboard-actions-theme.server.ts`                           | Call helper when embed already enabled after select      |
| `app/lib/dashboard-loader-core.ts`                                    | Select + default for flag                                |
| `app/lib/dashboard-loader.server.ts`                                  | Expose `onboardingActivated` on config                   |
| `app/components/Step1Activate.tsx`                                    | Theme Save UX + unlock gate + POST first-activation      |
| `tests/first-activation.test.js`                                      | Eligibility + UI markup tests                            |
| `tests/dashboard-loader.test.js`                                      | Assert select includes new field if pattern requires     |

---

### Task 1: Schema — `onboardingActivated`

**Files:**

- Modify: `prisma/schema.prisma` (`StoreConfig`)
- Modify: `admin-panel/prisma/schema.prisma` (`StoreConfig`)
- Create: `prisma/migrations/20261120160000_onboarding_activated/migration.sql`
- Test: `npm run check:schema`

**Interfaces:**

- Produces: `StoreConfig.onboardingActivated: Boolean @default(false)`

- [ ] **Step 1: Add field to root schema**

In `prisma/schema.prisma` on `StoreConfig`, after `adminManaged`:

```prisma
  onboardingActivated Boolean @default(false) // First auto/manual enable completed; never auto-enable again
```

- [ ] **Step 2: Mirror on admin-panel schema**

Same field on `admin-panel/prisma/schema.prisma` `StoreConfig` (after `adminManaged`).

- [ ] **Step 3: Create migration with backfill**

`prisma/migrations/20261120160000_onboarding_activated/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "onboardingActivated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: stores that already left first-run must not auto-enable again
UPDATE "StoreConfig"
SET "onboardingActivated" = true
WHERE "appEnabled" = true
   OR "auditComplete" = true
   OR "auditFailed" = true
   OR "auditRunning" = true;
```

Do **not** create a duplicate migration under `admin-panel/prisma/migrations` unless that tree is the deploy source for the same DB; root `prisma/migrations` is canonical for app DB. Admin schema must still declare the field for drift check.

- [ ] **Step 4: Verify schema drift check**

Run: `npm run check:schema`  
Expected: exit 0 (no StoreConfig drift).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma admin-panel/prisma/schema.prisma prisma/migrations/20261120160000_onboarding_activated/migration.sql
git commit -m "$(cat <<'EOF'
Add StoreConfig.onboardingActivated for first-activation gate.

Backfill existing stores that already enabled or audited so they are not auto-enabled again.
EOF
)"
```

---

### Task 2: Pure eligibility helper + tests

**Files:**

- Create: `app/lib/first-activation.ts`
- Create: `tests/first-activation.test.js`

**Interfaces:**

- Produces:
  - `export type FirstActivationSnapshot = { onboardingActivated: boolean; adminManaged: boolean; appEnabled: boolean; hasStorefrontPassword: boolean; passwordProtected: boolean | null; embedEnabled: boolean }`
  - `export function isEligibleForFirstActivation(s: FirstActivationSnapshot): boolean`
  - `export function shouldUnlockStep1Setup(embedStatus: string | null | undefined): boolean` → true only when `embedStatus === "enabled"`

- [ ] **Step 1: Write failing tests**

`tests/first-activation.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEligibleForFirstActivation,
  shouldUnlockStep1Setup,
} from "../app/lib/first-activation.ts";

const base = {
  onboardingActivated: false,
  adminManaged: false,
  appEnabled: false,
  hasStorefrontPassword: false,
  passwordProtected: false,
  embedEnabled: true,
};

test("unlock only when embedStatus is enabled", () => {
  assert.equal(shouldUnlockStep1Setup("enabled"), true);
  assert.equal(shouldUnlockStep1Setup("disabled"), false);
  assert.equal(shouldUnlockStep1Setup("unknown"), false);
  assert.equal(shouldUnlockStep1Setup(null), false);
});

test("eligible when embed on, not activated, not admin-managed, not password-blocked", () => {
  assert.equal(isEligibleForFirstActivation(base), true);
});

test("not eligible when already activated", () => {
  assert.equal(isEligibleForFirstActivation({ ...base, onboardingActivated: true }), false);
});

test("not eligible when adminManaged", () => {
  assert.equal(isEligibleForFirstActivation({ ...base, adminManaged: true }), false);
});

test("not eligible when embed off", () => {
  assert.equal(isEligibleForFirstActivation({ ...base, embedEnabled: false }), false);
});

test("not eligible when password protected without saved password", () => {
  assert.equal(
    isEligibleForFirstActivation({
      ...base,
      passwordProtected: true,
      hasStorefrontPassword: false,
    }),
    false,
  );
});

test("eligible when password protected with saved password", () => {
  assert.equal(
    isEligibleForFirstActivation({
      ...base,
      passwordProtected: true,
      hasStorefrontPassword: true,
    }),
    true,
  );
});

test("passwordProtected null does not block (inconclusive)", () => {
  assert.equal(isEligibleForFirstActivation({ ...base, passwordProtected: null }), true);
});

test("already appEnabled is not eligible for first-activation helper", () => {
  assert.equal(isEligibleForFirstActivation({ ...base, appEnabled: true }), false);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --import tsx --test tests/first-activation.test.js`  
Expected: FAIL (module missing).

- [ ] **Step 3: Implement pure helpers**

`app/lib/first-activation.ts`:

```ts
export type FirstActivationSnapshot = {
  onboardingActivated: boolean;
  adminManaged: boolean;
  appEnabled: boolean;
  hasStorefrontPassword: boolean;
  passwordProtected: boolean | null;
  embedEnabled: boolean;
};

export function shouldUnlockStep1Setup(embedStatus: string | null | undefined): boolean {
  return embedStatus === "enabled";
}

export function isEligibleForFirstActivation(s: FirstActivationSnapshot): boolean {
  if (s.onboardingActivated) return false;
  if (s.adminManaged) return false;
  if (s.appEnabled) return false;
  if (!s.embedEnabled) return false;
  if (s.passwordProtected === true && !s.hasStorefrontPassword) return false;
  return true;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --import tsx --test tests/first-activation.test.js`  
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/first-activation.ts tests/first-activation.test.js
git commit -m "$(cat <<'EOF'
Add first-activation eligibility helpers and unit tests.
EOF
)"
```

---

### Task 3: `maybeFirstActivation` server + intent registration

**Files:**

- Create: `app/lib/first-activation.server.ts`
- Modify: `shared/action-schemas.ts`
- Modify: `app/lib/dashboard-actions.server.ts`
- Modify: `app/lib/dashboard-actions-audit.server.ts` (set `onboardingActivated` on successful enable)

**Interfaces:**

- Consumes: `isEligibleForFirstActivation`, `handleToggleApp`, `getPasswordProtection`, `isAppEmbedEnabled`, `getSelectedThemeId`, prisma
- Produces:
  - `export async function maybeFirstActivation({ admin, session, activityMeta? }): Promise<{ ok: boolean; activated?: boolean; auditStarted?: boolean; reason?: string; config?: unknown }>`
  - Intent handler `handleMaybeFirstActivation` → same return shape
  - Intent name: `"maybe-first-activation"` (empty schema)

- [ ] **Step 1: Implement server helper**

`app/lib/first-activation.server.ts` (adapt imports to match repo style):

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { isEligibleForFirstActivation } from "./first-activation.ts";
import { handleToggleApp } from "./dashboard-actions-audit.server.ts";
import { getPasswordProtection } from "./password-protection.server";
import { isAppEmbedEnabled, getSelectedThemeId } from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";

const PASSWORD_CHECK_TIMEOUT_MS = 10_000;

export async function maybeFirstActivation({
  admin,
  session,
  activityMeta = {},
}: {
  admin: any;
  session: { shop: string };
  activityMeta?: Record<string, unknown>;
}) {
  const shop = session.shop;
  const store = await prisma.store.findUnique({
    where: { shopDomain: shop },
    select: {
      id: true,
      configs: {
        select: {
          onboardingActivated: true,
          adminManaged: true,
          appEnabled: true,
          storefrontPassword: true,
          isPasswordProtected: true,
          selectedThemeId: true,
        },
      },
    },
  });
  const sc = store?.configs?.[0];
  if (!sc) return { ok: true, activated: false, reason: "no_config" };
  if (sc.onboardingActivated) return { ok: true, activated: false, reason: "already_activated" };
  if (sc.adminManaged) return { ok: true, activated: false, reason: "admin_managed" };
  if (sc.appEnabled) {
    await prisma.storeConfig.updateMany({
      where: { storeId: store!.id, onboardingActivated: false },
      data: { onboardingActivated: true },
    });
    return { ok: true, activated: false, reason: "already_enabled" };
  }

  const selectedThemeId = sc.selectedThemeId || (await getSelectedThemeId(shop).catch(() => null));
  const embedCheck = await isAppEmbedEnabled(admin, undefined, selectedThemeId);
  const embedEnabled = embedCheck === true;

  let passwordProtected: boolean | null = sc.isPasswordProtected ?? null;
  if (passwordProtected === null) {
    try {
      passwordProtected = await withShopifyTimeout(
        getPasswordProtection(admin, shop),
        "passwordProtection",
        PASSWORD_CHECK_TIMEOUT_MS,
      );
    } catch (err) {
      rethrowAuthRedirect(err);
      passwordProtected = null;
    }
  }

  const eligible = isEligibleForFirstActivation({
    onboardingActivated: false,
    adminManaged: sc.adminManaged,
    appEnabled: false,
    hasStorefrontPassword: Boolean(sc.storefrontPassword),
    passwordProtected,
    embedEnabled,
  });
  if (!eligible) {
    return {
      ok: true,
      activated: false,
      reason: !embedEnabled
        ? "embed_required"
        : passwordProtected === true && !sc.storefrontPassword
          ? "password_required"
          : "not_eligible",
    };
  }

  const fd = new FormData();
  fd.set("intent", "toggle-app");
  fd.set("appEnabled", "true");
  const toggled = await handleToggleApp({
    admin,
    session,
    formData: fd,
    activityMeta: { ...activityMeta, by: activityMeta.by || "first-activation" },
  });
  if (!toggled?.ok) {
    return {
      ok: false,
      activated: false,
      reason: toggled?.error || "toggle_failed",
      ...toggled,
    };
  }

  await prisma.storeConfig.updateMany({
    where: { storeId: store!.id, onboardingActivated: false },
    data: { onboardingActivated: true },
  });

  return {
    ok: true,
    activated: true,
    auditStarted: toggled.auditStarted === true,
    config: toggled.config,
  };
}

export async function handleMaybeFirstActivation(args: any) {
  return maybeFirstActivation(args);
}
```

**Circular import note:** If `dashboard-actions-audit.server.ts` imports this file, do **not** import `handleToggleApp` from audit into `first-activation.server.ts` in a cycle. Prefer either:

- keep `maybeFirstActivation` inside `dashboard-actions-audit.server.ts`, **or**
- move shared “enable app + start audit” into a lower module both can import.

Choose the option that avoids a circular import; keep the public function name `maybeFirstActivation`.

- [ ] **Step 2: Register intent schema**

In `shared/action-schemas.ts` `INTENT_SCHEMAS`:

```ts
  "maybe-first-activation": {},
```

- [ ] **Step 3: Register handler in dispatcher**

In `app/lib/dashboard-actions.server.ts`:

```ts
import { handleMaybeFirstActivation } from "./first-activation.server.ts";
// or from dashboard-actions-audit.server.ts if colocated

const HANDLERS = {
  // ...
  "maybe-first-activation": handleMaybeFirstActivation,
};
```

- [ ] **Step 4: Set flag on manual toggle ON**

In `handleToggleApp`, after a successful enable write (`appEnabled === true`), also:

```ts
await prisma.storeConfig.updateMany({
  where: { store: { shopDomain: shop }, onboardingActivated: false },
  data: { onboardingActivated: true },
});
```

(Use the same storeId pattern already used in that file if preferred.)

- [ ] **Step 5: Smoke-typecheck / lint touched files**

Run: `npx tsc --noEmit -p tsconfig.json` if project supports it, or rely on existing `npm run typecheck` if fast enough.  
Expected: no new errors in the new modules.

- [ ] **Step 6: Commit**

```bash
git add app/lib/first-activation.server.ts shared/action-schemas.ts app/lib/dashboard-actions.server.ts app/lib/dashboard-actions-audit.server.ts
git commit -m "$(cat <<'EOF'
Add maybeFirstActivation intent and mark onboarding on enable.
EOF
)"
```

---

### Task 4: Wire password-save and select-theme call sites

**Files:**

- Modify: `app/lib/dashboard-actions-settings.server.ts`
- Modify: `app/lib/dashboard-actions-theme.server.ts`

**Interfaces:**

- Consumes: `maybeFirstActivation({ admin, session })`
- Produces: password-save / select-theme responses may include `firstActivation?: { activated, auditStarted }`

- [ ] **Step 1: Password save → maybeFirstActivation**

After a successful password upsert in `handleSaveStorefrontPassword`, replace the narrow “restart if already enabled + password error” block with:

1. Keep existing restart-if-already-enabled behavior for password-blocked audits when `appEnabled` is already true.
2. Additionally call `maybeFirstActivation({ admin, session })` when `appEnabled` was false (first run).

Return shape example:

```ts
return {
  ok: true,
  hasStorefrontPassword: true,
  auditRestarted: restarted === true,
  firstActivation: activation, // full helper result or { activated, auditStarted }
};
```

- [ ] **Step 2: select-theme → maybeFirstActivation when embed already on**

At end of `handleSelectTheme`, after computing `embed`:

```ts
let firstActivation = null;
if (embed === true) {
  firstActivation = await maybeFirstActivation({ admin, session });
}
return {
  ok: true,
  selectedThemeId: theme.id,
  embedStatus: embed === true ? "enabled" : embed === false ? "disabled" : "unknown",
  embedActivateUrl: getAppEmbedDeepLink(session.shop, undefined, undefined, theme.id),
  firstActivation,
};
```

- [ ] **Step 3: Commit**

```bash
git add app/lib/dashboard-actions-settings.server.ts app/lib/dashboard-actions-theme.server.ts
git commit -m "$(cat <<'EOF'
Trigger first activation after password save and theme select when embed is on.
EOF
)"
```

---

### Task 5: Expose `onboardingActivated` on dashboard config

**Files:**

- Modify: `app/lib/dashboard-loader-core.ts`
- Modify: `app/lib/dashboard-loader.server.ts`
- Modify: `tests/dashboard-loader.test.js` (assert select includes field)

**Interfaces:**

- Produces: `config.onboardingActivated: boolean` for Step1

- [ ] **Step 1: Add to `STORE_CONFIG_SELECT`**

```ts
  onboardingActivated: true,
```

- [ ] **Step 2: Add to `assembleFinalConfig` return**

In `dashboard-loader.server.ts` `assembleFinalConfig`:

```ts
    onboardingActivated: sc?.onboardingActivated === true,
```

- [ ] **Step 3: Extend loader test**

In `tests/dashboard-loader.test.js`, assert:

```js
assert.equal(STORE_CONFIG_SELECT.onboardingActivated, true);
```

- [ ] **Step 4: Run loader test**

Run: `node --import tsx --test tests/dashboard-loader.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/dashboard-loader-core.ts app/lib/dashboard-loader.server.ts tests/dashboard-loader.test.js
git commit -m "$(cat <<'EOF'
Expose onboardingActivated on dashboard loader config.
EOF
)"
```

---

### Task 6: Step1 UI — theme Save + unlock gate

**Files:**

- Modify: `app/components/Step1Activate.tsx`
- Modify: `tests/first-activation.test.js` (add SSR markup tests)

**Interfaces:**

- Consumes: `shouldUnlockStep1Setup`, `selectedThemeId`, `embedStatus`, `config.onboardingActivated`
- Produces: Phase 0/1/2 visibility behavior from the spec

- [ ] **Step 1: Write failing UI markup tests**

Append to `tests/first-activation.test.js` (render `Step1Activate` via `renderToStaticMarkup`). Mock `useFetcher` / react-router if needed — if mocking is heavy, instead extract a pure presentational helper:

Preferred extract (keep Step1 thin):

```ts
// app/lib/step1-visibility.ts
export function step1Visibility({
  themeSaved,
  setupUnlocked,
}: {
  themeSaved: boolean;
  setupUnlocked: boolean;
}) {
  return {
    showInstall: themeSaved,
    showSetupControls: setupUnlocked, // marketing, toggle, urls, audit chrome
  };
}
```

Tests:

```js
import { step1Visibility } from "../app/lib/step1-visibility.ts";

test("phase0: no install, no setup", () => {
  assert.deepEqual(step1Visibility({ themeSaved: false, setupUnlocked: false }), {
    showInstall: false,
    showSetupControls: false,
  });
});

test("phase1: install only", () => {
  assert.deepEqual(step1Visibility({ themeSaved: true, setupUnlocked: false }), {
    showInstall: true,
    showSetupControls: false,
  });
});

test("phase2: install + setup", () => {
  assert.deepEqual(step1Visibility({ themeSaved: true, setupUnlocked: true }), {
    showInstall: true,
    showSetupControls: true,
  });
});
```

- [ ] **Step 2: Run — expect FAIL, then implement `step1-visibility.ts`, expect PASS**

- [ ] **Step 3: Update `Step1Activate` theme picker**

Behavior changes:

1. Local draft: `const [themeDraftId, setThemeDraftId] = useState("")` synced from `shownThemeId` when themes load / selectedThemeId changes, **without** POSTing on every change.
2. `onChange` of `<s-select>` only updates `themeDraftId`.
3. Add **Save** button next to the select that calls existing `handleSelectTheme(themeDraftId)` (POST `select-theme`).
4. Disable Save when draft empty, equals persisted id, or `savingTheme`.
5. `themeSaved` = Boolean(persisted `selectedThemeId` that exists in themes list) OR successful select for current draft.
6. `setupUnlocked = shouldUnlockStep1Setup(embedStatus)`.
7. Show Install / Open theme editor **only if** `themeSaved`.
8. Wrap marketing copy, toggle, password/URL row, audit running/failed chrome in `setupUnlocked` condition.
9. Brand image may stay visible always.

Pseudocode structure:

```tsx
const setupUnlocked = shouldUnlockStep1Setup(embedStatus);
const { showInstall, showSetupControls } = step1Visibility({
  themeSaved,
  setupUnlocked,
});

{/* theme card always */}
{showInstall && <InstallButton ... />}
{/* brand image */}
{showSetupControls && (
  <>
    {/* marketing, toggle, password, urls, audit UI */}
  </>
)}
```

- [ ] **Step 4: Manual sanity in browser (dev)**

With `npm run dev`: fresh store / reset theme → only theme card + Save; after Save → Install; after embed on → controls.

- [ ] **Step 5: Commit**

```bash
git add app/components/Step1Activate.tsx app/lib/step1-visibility.ts tests/first-activation.test.js
git commit -m "$(cat <<'EOF'
Gate Step 1 setup UI behind theme Save and enabled embed.
EOF
)"
```

---

### Task 7: Client POST `maybe-first-activation` when unlocked

**Files:**

- Modify: `app/components/Step1Activate.tsx`
- Modify: `app/routes/app._index.jsx` only if needed to refresh audit UI from `firstActivation.auditStarted` (prefer handling inside Step1 via existing `onAuditRestarted` / fetcher data)

**Interfaces:**

- Consumes: `config.onboardingActivated`, `setupUnlocked`, `readOnly`, password readiness
- Produces: one-shot POST `intent=maybe-first-activation`

- [ ] **Step 1: Add activation fetcher effect**

In `Step1Activate`:

```tsx
const activateFetcher = useFetcher();
const activationAttemptedRef = useRef(false);

useEffect(() => {
  if (readOnly) return;
  if (!setupUnlocked) return;
  if (config.onboardingActivated) return;
  if (passwordRequired) return; // wait for password save path
  if (activationAttemptedRef.current) return;
  if (activateFetcher.state !== "idle") return;
  activationAttemptedRef.current = true;
  void activateFetcher.submit({ intent: "maybe-first-activation" }, { method: "POST" });
}, [readOnly, setupUnlocked, config.onboardingActivated, passwordRequired, activateFetcher]);
```

Reset `activationAttemptedRef` when `selectedThemeId` changes to a new theme (optional; flag on server still protects).

- [ ] **Step 2: On successful activation with `auditStarted`, call `onAuditRestarted?.()`** so parent enters audit polling (same as password restart).

Also treat `selectFetcher.data?.firstActivation?.activated` / `pwFetcher` / `activateFetcher` similarly.

- [ ] **Step 3: Ensure optimistic toggle UI**

When `activateFetcher.data?.activated` / returned `config.appEnabled`, Step1 should show toggle ON and audit loader (reuse existing `appEnabled` derivation; merge activateFetcher config if needed).

- [ ] **Step 4: Commit**

```bash
git add app/components/Step1Activate.tsx
git commit -m "$(cat <<'EOF'
Auto-request first activation when Step 1 setup unlocks.
EOF
)"
```

---

### Task 8: End-to-end verification checklist

**Files:** none required beyond fixes found during verification

- [ ] **Step 1: Unit suite**

Run:

```bash
node --import tsx --test tests/first-activation.test.js tests/dashboard-loader.test.js
```

Expected: PASS.

- [ ] **Step 2: Manual checklist (dev store)**

1. New / reset merchant: no marketing, toggle, password, URLs until embed enabled.
2. Theme dropdown change without Save does not persist; Save persists and reveals Install.
3. Non-password store: after embed enabled, app auto-ON + audit starts once.
4. Password store: password field appears; after save, auto-ON + audit.
5. Toggle OFF, edit URLs, reload → stays OFF (no re-auto).
6. Manual toggle ON still works after first activation.
7. Stop audit still works.

- [ ] **Step 3: Fix any gaps found; commit fixes separately**

```bash
git commit -m "$(cat <<'EOF'
Fix Step 1 extension-gate issues found in verification.
EOF
)"
```

---

## Spec coverage self-check

| Spec requirement                              | Task             |
| --------------------------------------------- | ---------------- |
| Hide controls until embed enabled             | Task 6           |
| Explicit theme Save before Install            | Task 6           |
| Auto-enable non-password first run            | Tasks 3, 4, 7    |
| Password then auto-enable                     | Tasks 4, 6, 7    |
| URLs always visible after unlock              | Task 6           |
| Sticky no re-auto (`onboardingActivated`)     | Tasks 1, 3, 5    |
| POST-only activation / read-only embed-status | Tasks 3, 7       |
| adminManaged skip                             | Tasks 2, 3       |
| Backfill existing stores                      | Task 1           |
| Tests                                         | Tasks 2, 5, 6, 8 |

## Placeholder / consistency review

- Intent name consistently `maybe-first-activation`.
- Flag name consistently `onboardingActivated`.
- Unlock helper consistently `shouldUnlockStep1Setup` / `embedStatus === "enabled"`.
- No TBD/TODO left in task steps.
