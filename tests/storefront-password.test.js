import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptStorefrontPassword,
  decryptStorefrontPassword,
  passwordLooksEncrypted,
} from "../app/lib/storefront-password.server.ts";

test("encrypts and decrypts with a key", () => {
  process.env.STOREFRONT_PASSWORD_KEY = "test-key-for-pagepulse";
  const secret = "my-storefront-password";
  const stored = encryptStorefrontPassword(secret);
  assert.ok(stored);
  assert.notEqual(stored, secret);
  assert.equal(passwordLooksEncrypted(stored), true);
  assert.equal(decryptStorefrontPassword(stored), secret);
});

test("two encryptions of the same password differ (random IV)", () => {
  process.env.STOREFRONT_PASSWORD_KEY = "test-key-for-pagepulse";
  const a = encryptStorefrontPassword("same");
  const b = encryptStorefrontPassword("same");
  assert.notEqual(a, b);
});

test("legacy plaintext values still decrypt to themselves", () => {
  process.env.STOREFRONT_PASSWORD_KEY = "test-key-for-pagepulse";
  assert.equal(decryptStorefrontPassword("plain-password"), "plain-password");
  assert.equal(passwordLooksEncrypted("plain-password"), false);
});

test("empty values stay null", () => {
  assert.equal(encryptStorefrontPassword(""), null);
  assert.equal(decryptStorefrontPassword(null), null);
  assert.equal(decryptStorefrontPassword(undefined), null);
});

test("corrupt ciphertext does not throw", () => {
  process.env.STOREFRONT_PASSWORD_KEY = "test-key-for-pagepulse";
  assert.equal(decryptStorefrontPassword("enc:v1:not-valid-base64!!"), null);
});
