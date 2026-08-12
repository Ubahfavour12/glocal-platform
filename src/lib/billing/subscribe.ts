/**
 * Subscription checkout helpers (Phase 4). Pure functions shared by the
 * `/api/billing/subscribe` initiator and the Flutterwave webhook. The charge
 * only flows for real once live payment keys exist; the logic is built and
 * tested now so it's "paste keys, flip on" at launch.
 */

import { TIERS } from "./tiers";
import { isTierId, type TierId } from "./subscription";

/** Monthly price of a tier in USD minor units (e.g. Growth $99 → 9900). */
export function subscriptionPriceUsdMinor(tier: TierId): number {
  const t = TIERS.find((x) => x.id === tier);
  if (!t) throw new Error(`unknown tier ${tier}`);
  return Math.round(t.priceUsdMonthly * 100);
}

export type ChargePurpose =
  | { kind: "subscription"; tier: TierId }
  | { kind: "topup" }
  | { kind: "ignore" };

/**
 * Decide what a verified charge is for, from its meta. A subscription charge
 * carries purpose:"subscription" + a valid tier; any other charge with a
 * business_id is treated as the original wallet top-up; anything without a
 * business_id is ignored (nothing to credit).
 */
export function classifyCharge(
  meta: { business_id?: string; purpose?: string; tier?: string } | null,
): ChargePurpose {
  if (!meta?.business_id) return { kind: "ignore" };
  if (meta.purpose === "subscription") {
    return isTierId(meta.tier) ? { kind: "subscription", tier: meta.tier } : { kind: "ignore" };
  }
  return { kind: "topup" };
}

/** A unique, greppable transaction reference for a subscription charge. */
export function subscriptionTxRef(businessId: string): string {
  return `sub-${businessId.slice(0, 8)}-${Date.now()}`;
}

/**
 * Tolerance on the paid amount, in basis points. FX rounding and PSP fees can
 * shave a little off the converted figure, so an exact-match check would reject
 * honest payments. 2% is wide enough for rounding and far too narrow to let a
 * cheaper tier through: the smallest gap between tiers is Starter to Growth,
 * which is 154%.
 */
const UNDERPAY_TOLERANCE_BPS = 200;

/** Does the amount actually paid cover the tier being activated? */
export function coversSubscription(paidUsdMinor: number, expectedUsdMinor: number): boolean {
  if (!Number.isFinite(paidUsdMinor) || paidUsdMinor <= 0) return false;
  const floor = Math.floor((expectedUsdMinor * (10_000 - UNDERPAY_TOLERANCE_BPS)) / 10_000);
  return paidUsdMinor >= floor;
}
