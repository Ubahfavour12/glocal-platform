/**
 * Primitives shared by every money rail.
 *
 * Flutterwave and Paystack differ in almost every surface detail — amount
 * units, envelope shape, status spelling, how a webhook proves it is genuine —
 * but the things that touch the ledger must not differ at all. Those live
 * here, once, so a second rail cannot quietly credit on different arithmetic
 * than the first.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What a charge carries to the PSP and brings back from verification.
 * Wallet top-ups carry usd_minor + fx_rate (the credit is computed from them);
 * subscription charges additionally carry purpose + tier.
 */
export interface ChargeMeta {
  business_id?: string;
  usd_minor?: number;
  fx_rate?: number;
  purpose?: string;
  tier?: string;
}

export interface CheckoutRequest {
  txRef: string;
  amountLocalMinor: number;
  currency: string; // e.g. NGN
  customerEmail: string;
  customerName: string;
  redirectUrl: string;
  /** hosted-checkout title (defaults to a wallet top-up) */
  title?: string;
  meta: ChargeMeta & { business_id: string };
}

/**
 * A charge as the PSP confirms it, normalised across rails.
 *
 * `status` is normalised to Flutterwave's spelling ("successful") because that
 * is what every existing caller already tests against. Paystack says
 * "success"; the adapter translates rather than making each call site know
 * which rail it is looking at.
 */
export interface VerifiedTransaction {
  id: number;
  txRef: string;
  status: "successful" | "failed" | string;
  amountLocalMinor: number;
  currency: string;
  meta: ChargeMeta | null;
}

/**
 * USD minor units to credit for a verified local payment, floor-rounded so
 * the ledger never over-credits (mirrors fx.usdCreditForLocal).
 */
export function usdCreditForVerified(
  amountLocalMinor: number,
  fxRate: number, // buffered local-per-USD rate quoted at checkout
): number {
  if (!(fxRate > 0)) throw new Error("fx rate must be positive");
  return Math.floor(amountLocalMinor / fxRate);
}

/**
 * Compare two secrets without leaking where they first differ.
 *
 * Length is compared first and non-constant-time, which leaks only the length
 * of a value the attacker is themselves supplying. `timingSafeEqual` throws on
 * a length mismatch, so the guard is required regardless.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * HMAC-SHA512 of a raw request body, hex encoded — Paystack's webhook proof.
 *
 * The RAW body matters: re-serialising parsed JSON reorders keys and drops
 * whitespace, so the hash would never match and every genuine webhook would be
 * rejected as a forgery.
 */
export function hmacSha512Hex(secret: string, rawBody: string): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Metadata as it comes back from a verify call.
 *
 * Paystack echoes metadata as an object when it was sent as one, but returns a
 * JSON *string* for charges started outside our checkout (their dashboard, a
 * payment link). Parsing defensively means such a charge is classified rather
 * than silently ignored.
 */
export function parseMeta(raw: unknown): ChargeMeta | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as ChargeMeta) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? (raw as ChargeMeta) : null;
}
