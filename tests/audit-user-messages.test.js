import { test } from "node:test";
import assert from "node:assert/strict";
import { auditErrorUserMessage } from "../app/lib/audit-user-messages.server.ts";

test("auditErrorUserMessage maps known codes", () => {
  assert.match(auditErrorUserMessage("QUEUE_TIMEOUT"), /timed out waiting/i);
  assert.match(auditErrorUserMessage("UNKNOWN_CODE"), /try again/i);
});
