/**
 * Time-based one-time passwords (RFC 6238), for the founder console.
 *
 * WHY THIS EXISTS. Sign-in is a magic link, so the EMAIL is the credential.
 * The console reads through the service role, which bypasses row-level
 * security on purpose -- it is the one page that can see every customer's
 * wallet, address and spend. Those two facts together mean that until now, a
 * compromised Gmail account was a compromised customer book, with one factor
 * and no second line.
 *
 * TOTP rather than a passphrase in an env var, deliberately. A static secret
 * in the environment leaks the way static secrets always leak: a screenshot, a
 * log line, an env dump, a shared `.env`. It also cannot be rotated without a
 * deploy. A TOTP secret is enrolled once into a phone and the thing an
 * attacker would have to steal changes every thirty seconds.
 *
 * Implemented here rather than pulled in: it is HMAC-SHA1 over a counter and
 * about forty lines, all of it in `node:crypto`. A dependency for this is a
 * supply-chain surface in the exact place where one would hurt most.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** RFC 6238 default. Authenticator apps assume it; do not change it. */
export const STEP_SECONDS = 30;
export const DIGITS = 6;

/**
 * How many steps either side of now are accepted.
 *
 * One, which is the usual answer: phone clocks drift by seconds, and a code
 * typed at the very end of its window arrives in the next one. Zero rejects
 * honest people; more than one widens the guessing window for no real gain.
 */
export const SKEW_STEPS = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode a base32 secret as authenticator apps spell it. Case and padding insensitive. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("secret is not valid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length === 0) throw new Error("secret is empty");
  return Buffer.from(out);
}

/** The code for a given counter step. */
function codeForCounter(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Big-endian 64-bit. Written as two 32-bit halves because a JS number
  // cannot hold the full range, and the high half is zero until the year
  // 10889 -- but writing it explicitly is clearer than pretending it is 32-bit.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", key).update(buf).digest();
  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code a correct authenticator shows right now. */
export function totp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return codeForCounter(base32Decode(secretBase32), counter);
}

/**
 * Is this the right code?
 *
 * Compared in constant time. The comparison leaks nothing useful on its own --
 * the code changes every thirty seconds -- but writing `===` here teaches the
 * next person that constant-time comparison is optional, and the next secret
 * they compare may not rotate.
 */
export function verifyTotp(
  secretBase32: string,
  submitted: string,
  atMs: number = Date.now(),
): boolean {
  const code = submitted.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    // A malformed secret must fail CLOSED. Returning true, or throwing into a
    // handler that catches broadly, would turn a configuration slip into an
    // open door.
    return false;
  }
  const now = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let i = -SKEW_STEPS; i <= SKEW_STEPS; i += 1) {
    const expected = codeForCounter(key, now + i);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Is a second factor configured at all? */
export function totpConfigured(): boolean {
  const s = process.env.ADMIN_TOTP_SECRET?.trim();
  if (!s) return false;
  try {
    // A secret that cannot be decoded is not a configured secret; saying so
    // here is what lets the gate refuse entry rather than wave everyone past.
    return base32Decode(s).length >= 10;
  } catch {
    return false;
  }
}
