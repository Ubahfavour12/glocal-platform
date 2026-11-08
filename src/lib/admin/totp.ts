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

/**
 * How far out a clock is searched once a code has already been refused.
 *
 * Twenty steps is ten minutes either way, which covers the usual cause -- a
 * phone with automatic time off, or a laptop that has drifted -- without
 * pretending to explain a code that is simply wrong.
 */
export const DIAGNOSTIC_STEPS = 20;

export type TotpDiagnosis =
  /** Accepted. */
  | { match: "in_window" }
  /** The right key, the wrong time. Positive means the clock runs fast. */
  | { match: "out_of_window"; offsetSeconds: number }
  /** Not a code from this key at any time nearby, or not a code at all. */
  | { match: "none" };

/**
 * Why was that code refused?
 *
 * "That code did not match" is true and useless. It is the same sentence for
 * a mistyped key, a stale key, and a phone whose clock is two minutes out --
 * three problems with three different fixes, and no way to tell them apart.
 * Searching a wider window turns the third into a sentence a person can act
 * on: your clock is about this far off.
 *
 * NOT AN ORACLE, and worth saying why. This is only reached behind a
 * signed-in, allowlisted founder session. Anyone who can get this far can
 * already ask for a code in the accepted window; learning that their guess
 * would have been right four minutes ago tells them nothing they could use.
 * The width is bounded so it cannot be walked outward indefinitely.
 */
export function diagnoseTotp(
  secretBase32: string,
  submitted: string,
  atMs: number = Date.now(),
): TotpDiagnosis {
  const code = submitted.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { match: "none" };
  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return { match: "none" };
  }
  if (verifyTotp(secretBase32, code, atMs)) return { match: "in_window" };

  const now = Math.floor(atMs / 1000 / STEP_SECONDS);
  // Nearest explanation first, so a code that happens to collide far away
  // does not outrank the drift that actually caused this.
  for (let distance = SKEW_STEPS + 1; distance <= DIAGNOSTIC_STEPS; distance += 1) {
    for (const i of [distance, -distance]) {
      if (codeForCounter(key, now + i) === code) {
        // A phone whose clock runs fast computes the code for a LATER step,
        // so a match at +2 means roughly a minute ahead, not behind.
        return { match: "out_of_window", offsetSeconds: i * STEP_SECONDS };
      }
    }
  }
  return { match: "none" };
}

/**
 * Say what a drifting clock means, in words someone can act on.
 *
 * Shared by enrolment and unlock so the two never drift apart in their
 * wording, which matters more than it sounds: this is the one sentence that
 * turns "it just doesn't work" into a thing to go and fix.
 */
export function describeClockSkew(offsetSeconds: number): string {
  const abs = Math.abs(offsetSeconds);
  const amount = abs >= 120 ? `${Math.round(abs / 60)} minutes` : `${abs} seconds`;
  const direction = offsetSeconds > 0 ? "ahead of" : "behind";
  return (
    `that key is right but your device clock is about ${amount} ${direction} ours — ` +
    `turn on automatic date & time (or, in Google Authenticator, Settings → ` +
    `Time correction for codes → Sync now) and try the next code`
  );
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
