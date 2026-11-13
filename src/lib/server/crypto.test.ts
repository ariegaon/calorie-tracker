import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptJson, encryptJson, signState, verifyState } from "./crypto.ts";

// Synthetic secrets only.
const SECRET = "test-secret-one";
const OTHER = "test-secret-two";

test("encrypted tokens round-trip and do not contain the plain text", () => {
  const tokens = { access: "access-token-value", refresh: "refresh-token-value", expires_at: 1794600000 };
  const stored = encryptJson(tokens, SECRET);
  assert.match(stored, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok(!stored.includes("access-token-value"));
  assert.deepEqual(decryptJson(stored, SECRET), tokens);
});

test("each encryption uses a fresh nonce", () => {
  assert.notEqual(encryptJson({ a: 1 }, SECRET), encryptJson({ a: 1 }, SECRET));
});

test("a wrong secret, altered text or junk gives null, not an error", () => {
  const stored = encryptJson({ a: 1 }, SECRET);
  assert.equal(decryptJson(stored, OTHER), null);
  const parts = stored.split(".");
  parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("AA") ? "BB" : "AA");
  assert.equal(decryptJson(parts.join("."), SECRET), null);
  assert.equal(decryptJson("not encrypted", SECRET), null);
  assert.equal(decryptJson("v2.a.b.c", SECRET), null);
});

test("an OAuth state is valid only for its user, its secret and its time window", () => {
  const now = 1_794_600_000_000;
  const state = signState("user-1", SECRET, now);
  assert.equal(verifyState(state, "user-1", SECRET, now + 60_000), true);
  assert.equal(verifyState(state, "user-2", SECRET, now + 60_000), false);
  assert.equal(verifyState(state, "user-1", OTHER, now + 60_000), false);
  assert.equal(verifyState(state, "user-1", SECRET, now + 16 * 60_000), false);
});

test("a tampered or malformed state is rejected", () => {
  const now = 1_794_600_000_000;
  const [expires, signature] = signState("user-1", SECRET, now).split(".");
  assert.equal(verifyState(`${Number(expires) + 3_600_000}.${signature}`, "user-1", SECRET, now), false);
  assert.equal(verifyState(`${expires}.${signature}x`, "user-1", SECRET, now), false);
  assert.equal(verifyState("", "user-1", SECRET, now), false);
  assert.equal(verifyState("abc", "user-1", SECRET, now), false);
});
