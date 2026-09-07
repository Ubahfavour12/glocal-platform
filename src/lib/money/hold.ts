/**
 * What a day's ad plan actually costs the wallet.
 *
 * The budget is what reaches the ad network; the markup is what the platform
 * charges on top of it. Both leave the customer's balance, so holding only the
 * budget would still leave them looking at money they cannot keep.
 *
 * The fee rounds UP, exactly as `record_spend` does in the database. If the
 * hold rounded down it would be a cent short of the eventual charge, and the
 * last plan of a nearly-empty wallet would fail at settlement rather than at
 * the point the customer could still do something about it.
 */

export function markupFeeUsdMinor(spendUsdMinor: number, markupBps: number): number {
  assertMinor(spendUsdMinor, "spend");
  if (!Number.isInteger(markupBps) || markupBps < 0 || markupBps > 3000) {
    throw new Error(`markup must be 0-3000 bps, got ${markupBps}`);
  }
  return Math.ceil((spendUsdMinor * markupBps) / 10_000);
}

/** Budget plus its markup: the most a day's plan can take from the wallet. */
export function holdAmountUsdMinor(budgetUsdMinor: number, markupBps: number): number {
  assertMinor(budgetUsdMinor, "budget");
  return budgetUsdMinor + markupFeeUsdMinor(budgetUsdMinor, markupBps);
}

function assertMinor(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer of USD minor units, got ${n}`);
  }
}
