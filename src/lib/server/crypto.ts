// Server-only helpers: encrypting stored tokens and signing the OAuth "state" value.
// Keys are derived from a server secret, so nothing here can be reproduced in the browser.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(secret: string, purpose: string): Buffer {
  return createHash("sha256").update(`calorie-tracker:${purpose}:${secret}`).digest();
}

/** AES-256-GCM. Output: "v1.<iv>.<ciphertext>.<tag>", each part base64url. */
export function encryptJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, "tokens"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** Returns null when the text was not produced by encryptJson with the same secret, or was altered. */
export function decryptJson(text: string, secret: string): unknown | null {
  const parts = text.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret, "tokens"), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

const STATE_LIFETIME_MS = 15 * 60 * 1000;

function stateSignature(userId: string, expires: number, secret: string): string {
  return createHmac("sha256", key(secret, "oauth-state")).update(`${userId}.${expires}`).digest("base64url");
}

/** A value to send through the OAuth redirect, tied to one user and valid for 15 minutes. */
export function signState(userId: string, secret: string, now: number = Date.now()): string {
  const expires = now + STATE_LIFETIME_MS;
  return `${expires}.${stateSignature(userId, expires, secret)}`;
}

/** True only for a state that was issued to this user and has not expired. */
export function verifyState(state: string, userId: string, secret: string, now: number = Date.now()): boolean {
  const [expiresText, signature] = state.split(".");
  const expires = Number(expiresText);
  if (!signature || !Number.isFinite(expires) || expires < now) return false;
  const expected = Buffer.from(stateSignature(userId, expires, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
