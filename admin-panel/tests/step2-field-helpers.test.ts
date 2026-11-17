import test from "node:test";
import assert from "node:assert/strict";
import {
  toEditable,
  validateArray,
  fieldsForScope,
} from "../src/lib/step2-field-helpers.ts";
import { scriptsForScope, tabDropdownAction } from "../src/lib/scan-summary-scope.ts";

test("toEditable pretty-prints arrays", () => {
  assert.equal(toEditable(["a"]), '[\n  "a"\n]');
});

test("validateArray rejects non-string arrays", () => {
  assert.equal(validateArray("[1]").valid, false);
  assert.equal(validateArray('["x"]').valid, true);
});

test("fieldsForScope returns four cards per tab", () => {
  assert.equal(fieldsForScope("home").length, 4);
  assert.equal(fieldsForScope("home")[0].key, "auditDeferHome");
});

test("tabDropdownAction matches merchant semantics", () => {
  assert.equal(
    tabDropdownAction(
      { auditDeferArray: ["xyz.js"], firstUserDelayScripts: [], staticDeferDefaults: [] },
      "xyz.js",
    ),
    "defer",
  );
  assert.equal(
    tabDropdownAction(
      { auditDeferArray: [], firstUserDelayScripts: [], staticDeferDefaults: [] },
      "g.js",
    ),
    "protected",
  );
});

test("scriptsForScope filters by page role", () => {
  const rows = [
    { token: "h.js", pages: ["/"] },
    { token: "p.js", pages: ["/products/x"] },
  ];
  const roles = { "/": "home", "/products/x": "product" };
  assert.deepEqual(
    scriptsForScope(rows, roles, "home").map((r) => r.token),
    ["h.js"],
  );
});
