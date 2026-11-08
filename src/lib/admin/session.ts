/**
 * The founder console's own session, separate from the customer's.
 *
 * Separate ON PURPOSE, and this is the point of the whole exercise. The
 * Supabase session proves "this email signed in via a magic link". That is a
 * reasonable claim for a customer dashboard and a weak one for a page that
 * bypasses row-level security and shows every customer's wallet. The second
 * cookie proves something the first cannot: that whoever is here also holds
 * the phone.
 *
 * Short-lived, because the asymmetry is stark -- an admin session left open on
 * a laptop is the whole book, and typing six digits again is eight seconds.
 *
 * Signed rather than stored. A server-side session table would be one more
 * thing to get wrong and would not be more secure: the cookie carries only an
 * expiry and an email, both already known to the holder, and an HMAC that
 * cannot be produced without the server secret. Nothing in it is worth
 * hiding; what matters is that it cannot be forged.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "glocal-ops";

/** Eight hours: a working day, not a month. */
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

/**
 * The key the cookie is signed with.
 *
 * Falls back to nothing, never to a default. A hardcoded development secret
 * is the kind of thing that reaches production and makes every signature
 * forgeable by anyone who has read the repository.
 */
function signingKey(): string | null {
  return process.env.ADMIN_SESSION_SECRET?.trim() || null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Mint a cookie value for an email, valid for ADMIN_SESSION_MS. */
export function issueAdminSession(email: string, nowMs: number = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = `${Buffer.from(email).toString("base64url")}.${nowMs + ADMIN_SESSION_MS}`;
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Who this cookie says is here, or null.
 *
 * Returns null for every failure -- unsigned, forged, expired, malformed,
 * no server secret. The caller cannot accidentally treat "I could not check"
 * as "it was fine", because there is only one shape of failure.
 */
export function readAdminSession(
  cookieValue: string | undefined,
  nowMs: number = Date.now(),
): string | null {
  const key = signingKey();
  if (!key || !cookieValue) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [emailPart, expiryPart, signature] = parts;
  const payload = `${emailPart}.${expiryPart}`;

  const expected = sign(payload, key);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Signature checked BEFORE the expiry is read. An attacker must not be able
  // to learn anything by submitting a forged cookie with an interesting date.
  const expiresAt = Number(expiryPart);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;

  try {
    const email = Buffer.from(emailPart, "base64url").toString("utf8");
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/** Is the console able to be opened at all, or is it unconfigured? */
export function adminSessionConfigured(): boolean {
  return signingKey() !== null;
}
