import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEligibleForFirstActivation,
  shouldUnlockStep1Setup,
} from "../app/lib/first-activation.ts";
import { step1Visibility } from "../app/lib/step1-visibility.ts";

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
