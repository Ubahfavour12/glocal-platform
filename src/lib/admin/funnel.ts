/**
 * Where customers stop.
 *
 * The console could already answer "who is stuck?" one row at a time, and
 * could not answer "where does everyone get stuck?" at all. Those are
 * different questions and only the second one tells you what to build next.
 *
 * It matters here more than it would elsewhere. There are eight businesses,
 * 315 plans written, 544 compliance checks passed -- and zero ads ever
 * launched. Every one of those stops at the same step. A funnel would have
 * put that on one line, months ago, instead of it being something you only
 * see by counting rows in the database.
 *
 * The steps are ordered by dependency, not by time: you cannot fund without
 * an account, cannot launch without funding. So each step counts businesses
 * that reached it, and the biggest drop between two steps is the thing to fix.
 */

export interface BusinessProgress {
  businessId: string;
  /** Finished onboarding: a category and a destination were chosen. */
  onboarded: boolean;
  /** An ad account or an active social connection exists. */
  connected: boolean;
  /** Money has arrived at some point, whether or not it is still there. */
  funded: boolean;
  /** At least one ad reached a platform. */
  launched: boolean;
}

export interface FunnelStep {
  key: "signed_up" | "onboarded" | "connected" | "funded" | "launched";
  label: string;
  count: number;
  /** How many were lost between the previous step and this one. */
  droppedFromPrevious: number;
}

export function funnel(rows: BusinessProgress[]): FunnelStep[] {
  const signedUp = rows.length;
  // Each step implies the ones before it. A business with money but no
  // connected account is still counted as funded -- the steps describe
  // progress reached, not a strict path walked in order, and pretending
  // otherwise would hide the customer who paid and then got stuck.
  const onboarded = rows.filter((r) => r.onboarded).length;
  const connected = rows.filter((r) => r.connected).length;
  const funded = rows.filter((r) => r.funded).length;
  const launched = rows.filter((r) => r.launched).length;

  const counts: [FunnelStep["key"], string, number][] = [
    ["signed_up", "Signed up", signedUp],
    ["onboarded", "Finished onboarding", onboarded],
    ["connected", "Connected an account", connected],
    ["funded", "Put money in", funded],
    ["launched", "Launched an ad", launched],
  ];

  return counts.map(([key, label, count], i) => ({
    key,
    label,
    count,
    droppedFromPrevious: i === 0 ? 0 : Math.max(0, counts[i - 1][2] - count),
  }));
}

/**
 * The step losing the most people.
 *
 * Returns the step itself rather than the gap before it, because "customers
 * are not getting to X" is what a person acts on. Null when nobody is lost,
 * which at the moment would be surprising.
 */
export function worstDrop(steps: FunnelStep[]): FunnelStep | null {
  const lossy = steps.filter((s) => s.droppedFromPrevious > 0);
  if (lossy.length === 0) return null;
  return lossy.reduce((worst, s) =>
    s.droppedFromPrevious > worst.droppedFromPrevious ? s : worst,
  );
}

/**
 * Money being held that is not ours.
 *
 * Customer wallet balances are prepaid advertising money. It sits in our
 * payment account and it is spoken for -- every penny is refundable on
 * request, as the terms say. Shown separately from revenue, and never added
 * to it, because the one mistake that would really hurt here is treating
 * float as income and spending it.
 */
export function walletFloatUsdMinor(balances: number[]): number {
  return balances.reduce((t, b) => t + (Number.isFinite(b) && b > 0 ? b : 0), 0);
}
