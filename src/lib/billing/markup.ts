/**
 * Ad-spend markup math (Phase 4). The subscription roughly covers cost; the
 * markup on ad spend is the business (Pricing-Model v1.0). Charged per ad-spend
 * as a separate `markup_fee` ledger entry — never at deposit — so a subscriber
 * who never advertises pays no markup and keeps a fully refundable balance.
 * Pure + fixture-tested; the wallet/launcher call these when payments go live.
 */

/** The service fee on a given ad spend, in USD minor units. bps = basis points (1500 = 15%). */
export function markupFeeMinor(adSpendUsdMinor: number, markupBps: number): number {
  if (adSpendUsdMinor <= 0 || markupBps <= 0) return 0;
  return Math.round((adSpendUsdMinor * markupBps) / 10_000);
}

/** Total drawn from the wallet for a given ad spend: the spend plus its markup. */
export function totalWalletDebitMinor(adSpendUsdMinor: number, markupBps: number): number {
  return adSpendUsdMinor + markupFeeMinor(adSpendUsdMinor, markupBps);
}

/**
 * Given a wallet budget, the most that can actually reach the ad network so that
 * spend + its markup still fits the budget. This is what the launcher should cap
 * daily ad spend at, so the wallet never over-commits.
 *   budget = spend * (1 + bps/10000)  ->  spend = budget * 10000 / (10000 + bps)
 */
export function affordableAdSpendMinor(budgetUsdMinor: number, markupBps: number): number {
  if (budgetUsdMinor <= 0) return 0;
  if (markupBps <= 0) return budgetUsdMinor;
  return Math.floor((budgetUsdMinor * 10_000) / (10_000 + markupBps));
}
