import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldSkipPsiFetch,
  psiReportLooksLikePasswordGate,
} from "../app/lib/psi.server.ts";

test("shouldSkipPsiFetch when storefront is password-protected", () => {
  assert.equal(shouldSkipPsiFetch(true), true);
  assert.equal(shouldSkipPsiFetch(false), false);
  assert.equal(shouldSkipPsiFetch(null), false);
});

test("psiReportLooksLikePasswordGate detects Shopify lock screen URL", () => {
  assert.equal(
    psiReportLooksLikePasswordGate({
      lighthouseResult: {
        requestedUrl: "https://shop.myshopify.com/password",
      },
    }),
    true,
  );
  assert.equal(
    psiReportLooksLikePasswordGate({
      lighthouseResult: {
        requestedUrl: "https://shop.myshopify.com/products/foo",
      },
    }),
    false,
  );
});
