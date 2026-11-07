/**
 * Is there any point running the nightly job for this business tonight?
 *
 * THE WASTE THIS EXISTS TO STOP. Every night the job writes a plan for every
 * business: it tops the concept pool up toward the tier's target (a
 * Sonnet-class call), judges yesterday, and files an approval row. For an
 * account with nowhere to advertise, nowhere to post and no money, every one
 * of those is work nobody can act on. The duplicate businesses deleted in
 * migration 0042 had accumulated 83 approval plans each before anyone noticed,
 * and they were only the visible case — a real account that signs up and never
 * connects anything costs exactly the same, forever.
 *
 * THE THIRD CONDITION IS THE ONE THAT MATTERS. The obvious rule is "no ad
 * account and no money", and it is wrong: the Organic tier has neither by
 * design. It has no wallet and no ad account and it works — it posts to
 * connected social accounts. A gate that checked only the first two would
 * silently switch off the entire free tier, which is also the tier most likely
 * to convert. So dormancy means all three: nowhere to advertise, nowhere to
 * post, and nothing to spend.
 *
 * The gate opens by itself. Nothing marks an account dormant and nothing has
 * to un-mark it: the night after someone connects a page or tops up, the
 * predicate returns false and they are back in the run.
 */

export interface DormancySignals {
  /** A connected ad platform account — somewhere an ad could actually run. */
  hasAdAccount: boolean;
  /** A connected social account — somewhere an organic post could go. */
  hasSocial: boolean;
  /** Wallet balance in USD minor units. No wallet counts as zero. */
  balanceUsdMinor: number;
}

/**
 * Pure and total. A business is dormant only when it can act on nothing the
 * nightly run would produce.
 *
 * Erring toward RUNNING is deliberate: the cost of running for an account that
 * did not need it is some tokens, and the cost of skipping one that did is a
 * customer whose agent silently stopped. Any one signal is enough to run.
 */
export function isDormant(s: DormancySignals): boolean {
  const funded = Number.isFinite(s.balanceUsdMinor) && s.balanceUsdMinor > 0;
  return !s.hasAdAccount && !s.hasSocial && !funded;
}
