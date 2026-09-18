/**
 * Which ad brought leads, and which brought BUSINESS.
 *
 * These are different questions and they routinely have different answers. The
 * verdict engine already counts a Meta lead event as a conversion intent, so
 * without this the cheapest leads win — which is exactly backwards when cheap
 * leads never close. "Lead quality" is the phrase people use for that gap, and
 * it is the thing a social media manager running real budgets named as their
 * single biggest pain point.
 *
 * Everything here is pure. It takes rows and returns numbers, so it can be
 * tested exhaustively without a database, and so the same arithmetic serves the
 * duel, the weekly report and the agent's own explanation of what it did.
 *
 * MONEY IS IN USD MINOR UNITS throughout, like the rest of the ledger. Mixing
 * majors and minors is the classic way to be wrong by a factor of a hundred and
 * confident about it.
 */

export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";

export interface LeadRow {
  creativeId: string | null;
  status: LeadStatus;
  valueUsdMinor: number | null;
}

export interface CreativeQuality {
  creativeId: string;
  leads: number;
  /** Reached at least "qualified" — includes those that went on to win. */
  qualified: number;
  won: number;
  lost: number;
  /** Still in play: new or contacted. Neither a success nor a failure yet. */
  open: number;
  revenueUsdMinor: number;
  spendUsdMinor: number;

  /** Of leads whose outcome is KNOWN, what share closed. Null while none have. */
  winRate: number | null;
  /** Spend per won deal. Null with no wins — deliberately not Infinity. */
  costPerWonUsdMinor: number | null;
  /** Spend per lead of any kind, which is the number that flatters a bad ad. */
  costPerLeadUsdMinor: number | null;
  averageDealUsdMinor: number | null;
  /** Revenue per unit of spend. The honest headline when outcomes are known. */
  returnOnSpend: number | null;
}

/**
 * Win rate counts only DECIDED leads.
 *
 * Including still-open leads in the denominator makes every campaign look worse
 * the fresher it is, and makes a brand-new ad with ten untouched leads look
 * like a total failure. The question being answered is "of the ones you have
 * finished with, how many closed" — which is the only version that is stable as
 * the week goes on.
 */
export function decided(rows: LeadRow[]): number {
  return rows.filter((r) => r.status === "won" || r.status === "lost").length;
}

function ratio(numerator: number, denominator: number): number | null {
  // Null rather than Infinity or NaN. Those propagate silently through
  // arithmetic and surface later as a nonsense figure in front of a customer,
  // whereas null forces the caller to decide what "not yet known" should say.
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Roll leads up per creative, with the spend each creative actually took.
 *
 * `spendByCreative` is passed in rather than derived because spend lives with
 * the ad platform's insights, not with the leads, and joining them here would
 * mean this module needed a database.
 */
export function qualityByCreative(
  rows: LeadRow[],
  spendByCreative: Record<string, number>,
): CreativeQuality[] {
  const groups = new Map<string, LeadRow[]>();
  for (const r of rows) {
    // A hand-entered lead with no creative is real business but is not evidence
    // about any ad, so it is counted nowhere rather than being blamed on one.
    if (!r.creativeId) continue;
    const list = groups.get(r.creativeId) ?? [];
    list.push(r);
    groups.set(r.creativeId, list);
  }

  // Creatives that spent money and produced no leads at all must still appear.
  // Dropping them hides the worst performers, which is the opposite of useful.
  for (const id of Object.keys(spendByCreative)) {
    if (!groups.has(id)) groups.set(id, []);
  }

  const out: CreativeQuality[] = [];
  for (const [creativeId, list] of groups) {
    const won = list.filter((r) => r.status === "won");
    const lost = list.filter((r) => r.status === "lost").length;
    const open = list.filter((r) => r.status === "new" || r.status === "contacted").length;
    // "Qualified" means reached that bar, so a won lead counts: it passed
    // through qualification even if nobody clicked the button on the way.
    const qualified = list.filter(
      (r) => r.status === "qualified" || r.status === "won",
    ).length;

    const revenueUsdMinor = won.reduce((s, r) => s + (r.valueUsdMinor ?? 0), 0);
    const spendUsdMinor = spendByCreative[creativeId] ?? 0;

    out.push({
      creativeId,
      leads: list.length,
      qualified,
      won: won.length,
      lost,
      open,
      revenueUsdMinor,
      spendUsdMinor,
      winRate: ratio(won.length, decided(list)),
      costPerWonUsdMinor:
        won.length > 0 ? Math.round(spendUsdMinor / won.length) : null,
      costPerLeadUsdMinor:
        list.length > 0 ? Math.round(spendUsdMinor / list.length) : null,
      averageDealUsdMinor:
        won.length > 0 ? Math.round(revenueUsdMinor / won.length) : null,
      returnOnSpend: ratio(revenueUsdMinor, spendUsdMinor),
    });
  }
  return out;
}

/**
 * The sentence worth paying for.
 *
 * Returns the creative that produced the most LEADS and the one that produced
 * the most MONEY, when they differ. When they are the same ad there is no
 * insight to report and this returns null rather than manufacturing one —
 * "your best ad is also your best ad" is noise.
 *
 * Only speaks once outcomes are actually known. Early in a campaign every lead
 * is open, revenue is zero everywhere, and a confident claim then would be a
 * lie told with a straight face.
 */
export function volumeVersusValue(
  quality: CreativeQuality[],
): { mostLeads: CreativeQuality; mostRevenue: CreativeQuality } | null {
  const withRevenue = quality.filter((q) => q.revenueUsdMinor > 0);
  if (withRevenue.length === 0) return null;

  const mostLeads = [...quality].sort((a, b) => b.leads - a.leads)[0];
  const mostRevenue = [...withRevenue].sort(
    (a, b) => b.revenueUsdMinor - a.revenueUsdMinor,
  )[0];

  if (!mostLeads || !mostRevenue) return null;
  if (mostLeads.creativeId === mostRevenue.creativeId) return null;
  return { mostLeads, mostRevenue };
}

/**
 * Rank creatives for the next budget decision.
 *
 * Cost per WON deal, ascending — the cheapest way to buy actual business.
 * Creatives with no wins yet sort last rather than being excluded, because
 * "spent money, closed nothing" is a finding, not missing data.
 */
export function rankForBudget(quality: CreativeQuality[]): CreativeQuality[] {
  return [...quality].sort((a, b) => {
    const A = a.costPerWonUsdMinor;
    const B = b.costPerWonUsdMinor;
    if (A === null && B === null) return b.leads - a.leads;
    if (A === null) return 1;
    if (B === null) return -1;
    return A - B;
  });
}
