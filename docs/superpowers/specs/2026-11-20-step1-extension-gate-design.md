# Step 1 extension gate + first-activation auto-start

**Date:** 2026-11-20  
**Status:** Approved for planning  
**Approach:** Hybrid UI gate + server `maybeFirstActivation` (Approach 3)

## Problem

New merchants see Enable toggle, password fields, and PLP/PDP URL fields before the theme app embed is installed. That invites confusion and attempts to start an audit before the extension can work.

## Goals

1. Hide marketing copy, Enable toggle, password UI, and PLP/PDP URL fields until the app extension is **confirmed enabled** in the selected theme.
2. Require an explicit theme **Save** before showing Install / Open theme editor.
3. After extension is enabled:
   - If store is **not** password-protected → auto-enable app and auto-start the **first** audit.
   - If store **is** password-protected → show password field; after successful password save → same auto-enable + first audit.
4. Once unlocked, PLP/PDP URL box stays visible even when the toggle is OFF so merchants can edit URLs and re-audit.
5. Never auto-enable again after the first activation (merchant toggle-OFF to edit URLs must stick across reload).

## Non-goals

- Changing Step 2 / Step 3 flows.
- Changing admin-panel `forceAppOn` semantics.
- Auto-starting audit on every OFF→ON after first activation (existing `toggle-app` OFF→ON audit restart remains as today).
- Showing password UI for stores that are not password-protected (unless an audit hits a password block, same as today).

## Merchant UX phases

### Phase 0 — Fresh install / theme not saved

Visible:

- Step 1 header
- Theme card: “Choose the theme for the app extension”
- Theme dropdown (local draft; **not** persisted until Save)
- **Save** button

Hidden:

- Marketing line (“Improve loading speed…”)
- Enable Performance Improvement App toggle
- Password box
- PLP/PDP URL box
- Audit running / failed UI
- Install / Open theme editor button

### Phase 1 — Theme saved, extension not enabled

Same as Phase 0, plus:

- **Install extension in this theme** / **Open theme editor**
- Embed status copy (enabled / not enabled / unknown)

Still hidden: marketing, toggle, password, URLs, audit UI.

### Phase 2 — Extension confirmed enabled (`embedStatus === "enabled"`)

Reveal together:

- Marketing copy
- Enable toggle
- Password box **only if** password-protected (or password-block audit error / toggle blocked for password), same detection rules as today
- PLP/PDP URL box **always** (toggle on or off)

### Phase 3 — First activation

Triggered by server `maybeFirstActivation` when Phase 2 conditions are met and password is OK:

1. Set `appEnabled` (and default scripts ON, same as `toggle-app`)
2. Start first audit via `startAuditForStore`
3. Set `onboardingActivated = true`

Password path: successful `save-storefront-password` then runs the same helper.

After this, merchant may toggle OFF / stop audit, edit URLs, and re-enable or start audit manually.

## Architecture

### UI — `app/components/Step1Activate.tsx`

| Concern                  | Behavior                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Theme draft              | Local state for selected theme id; Save submits `select-theme`                               |
| Stop auto-save-on-change | `onChange` only updates draft; does not POST until Save                                      |
| `themeSaved`             | Persisted `selectedThemeId` matches a known theme (or latest successful select)              |
| `setupUnlocked`          | `embedStatus === "enabled"`                                                                  |
| Visibility               | Marketing / toggle / password / URLs / audit chrome only when `setupUnlocked`                |
| Install button           | Only after `themeSaved`                                                                      |
| Brand image              | May remain visible in Phase 0/1 as decoration; it is not a control and does not unlock setup |

### Server — shared helper

Add `maybeFirstActivation({ admin, session, activityMeta? })` (location: near dashboard audit/theme helpers, e.g. `dashboard-actions-audit.server.ts` or a small dedicated module).

**Eligibility (all required):**

1. Not `adminManaged` / not read-only merchant context that should skip auto-enable
2. `onboardingActivated === false`
3. Selected theme embed is enabled (`isAppEmbedEnabled === true`)
4. Password OK: store not password-protected **OR** `storefrontPassword` present
5. App currently off **or** already being enabled by this call path (idempotent)

**Actions when eligible:**

1. Enable app the same way as `handleToggleApp` ON (scripts 1–3 ON, sync, rebuild script, activity log)
2. `startAuditForStore`
3. Persist `onboardingActivated = true`

**Soft-fail:** If audit start fails after enable, keep app enabled and `onboardingActivated = true`; merchant can retry audit manually (match current toggle soft-fail).

### Call sites

Prefer **POST** paths only (no activation writes inside GET loaders).

| Trigger                                                   | Behavior                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `save-storefront-password` success                        | Call `maybeFirstActivation` (password-protected first run)                                                                             |
| `select-theme` when embed already enabled on chosen theme | Call `maybeFirstActivation`                                                                                                            |
| New intent `maybe-first-activation` (or equivalent)       | UI calls after embed re-check reports enabled (focus / return from theme editor / `api.embed-status`); server runs helper idempotently |
| Manual `toggle-app` ON                                    | Existing logic; also set `onboardingActivated = true` if not already                                                                   |

`api.embed-status` stays read-only; the client uses its result to decide whether to POST `maybe-first-activation`.

Do **not** rely on client-only “submit toggle once” without the server sticky flag.

### Schema

Add to `StoreConfig` (Remix `prisma/schema.prisma` and admin-panel schema if it mirrors StoreConfig):

```prisma
onboardingActivated Boolean @default(false)
```

Migration required. Backfill (single rule):

```sql
UPDATE "StoreConfig"
SET "onboardingActivated" = true
WHERE "appEnabled" = true
   OR "auditComplete" = true
   OR "auditFailed" = true
   OR "auditRunning" = true;
```

Intent: any store that already enabled the app or started/finished an audit must not receive first-activation auto-enable.

## Data flow (happy paths)

### Non-password store

```
Install app
  → Phase 0: pick theme → Save
  → Phase 1: Install extension → enable in theme editor → return
  → embed check true → Phase 2 UI
  → maybeFirstActivation → app ON + first audit (Phase 3)
  → URLs visible; merchant may toggle OFF to edit URLs and re-audit later
```

### Password-protected store

```
… same through Phase 2 …
  → password box visible; no auto-enable yet
  → save password → maybeFirstActivation → app ON + first audit
  → same URL / toggle-off behavior
```

## Edge cases

| Case                                       | Expected                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Theme selected, not Saved                  | Stay Phase 0                                                               |
| Theme Saved, embed off/unknown             | Phase 1 only; app stays off                                                |
| Embed on, password required, no password   | Phase 2; no auto-enable                                                    |
| Password save success                      | Auto-enable + first audit once                                             |
| Toggle OFF after first activation          | Stays off across reload                                                    |
| Switch to theme without embed              | Existing fail-closed disable; UI re-locks until embed enabled on new theme |
| Returning merchant (`onboardingActivated`) | No auto-enable                                                             |
| `readOnly` / `adminManaged`                | No auto-enable; existing banners                                           |
| Auto-enable fails audit start              | UI unlocked; toggle ON if enable succeeded; manual retry                   |

## Error handling

- Theme Save / theme list failures: existing critical/retry copy; do not unlock.
- Embed unknown: treat as **not unlocked** (fail closed for revealing setup controls).
- Password save failure: no activation.
- `maybeFirstActivation` race (double submit): idempotent via `onboardingActivated` / transactional update preference (`updateMany` where `onboardingActivated = false`).

## Testing

1. **UI visibility:** Phase 0 / 1 / 2 element presence and absence.
2. **Theme Save:** changing dropdown without Save does not persist; Save persists and reveals Install.
3. **Unlock:** only `embedStatus === "enabled"` reveals marketing/toggle/URLs.
4. **URLs always after unlock:** visible with toggle OFF.
5. **Non-password first activation:** embed enabled → app ON + audit started + flag set.
6. **Password first activation:** password save → app ON + audit started + flag set.
7. **No re-auto:** after flag set and toggle OFF, reload does not re-enable.
8. **Regression:** manual toggle, stop audit, URL save, extension_required / password_required guards still work.

## Files likely touched

- `app/components/Step1Activate.tsx` (+ possibly small step1 subcomponents)
- `app/lib/dashboard-actions-theme.server.ts`
- `app/lib/dashboard-actions-settings.server.ts` (password save)
- `app/lib/dashboard-actions-audit.server.ts` (toggle + helper)
- `app/routes/app._index.jsx` and/or loader helpers / `api.embed-status.jsx`
- `prisma/schema.prisma` (+ migration)
- `admin-panel/prisma/schema.prisma` if StoreConfig is mirrored
- Focused unit/integration tests under `app` / existing dashboard action tests

## Success criteria

- Merchants cannot see or use Enable / password / URL controls before extension is enabled.
- First eligible activation auto-starts without requiring a manual toggle.
- Merchants can turn the app off, edit URLs, and re-audit without being force-enabled again.
