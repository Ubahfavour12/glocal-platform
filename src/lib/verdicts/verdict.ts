/**
 * A/B verdict engine — Blueprint §4.2.
 * - Verdict threshold: minimum 24 hours AND 5,000 impressions per candidate.
 * - Evaluation window: rolling 3 days (absorbs attribution lag).
 * - Metric hierarchy: ROAS (store connected) → cost per WON lead → CPCI →
 *   engagement tiebreaker.
 * Never early-kills on thin data.
 */

export const MIN_HOURS = 24;
export const MIN_IMPRESSIONS = 5_000;
export const WINDOW_DAYS = 3;

/**
 * How many settled leads an ad needs before cost-per-won may decide a duel.
 *
 * Impressions already have a threshold; lead outcomes had none, so one win out
 * of two leads read as a 50% win rate and could win the duel outright. At that
 * sample a single customer changing their mind flips the answer, and the agent
 * would move real budget on it with no way to know it was noise.
 *
 * Five is deliberately modest. A stricter bar would be statistically nicer and
 * would mean the metric almost never fires for a small business running two ads
 * on $10 a day — a correct answer nobody ever gets is worth less than a
 * reasonable one they get this month. Below this the engine does not guess; it
 * falls through to cost per enquiry, which is weaker but honest about being a
 * proxy.
 */
export const MIN_DECIDED_LEADS = 5;

export interface DailyMetrics {
  date: Date;
  impressions: number;
  clicks: number;
  /** Conversion intents: WhatsApp opens, calls, store sessions. */
  intents: number;
  spendUsdMinor: number;
  revenueUsdMinor: number;
}

/**
 * What happened to the leads this ad produced, once a human said so.
 *
 * Kept OUTSIDE the daily series on purpose. A lead closes days or weeks after
 * the ad that produced it ran, so booking the win against a date would credit
 * whichever ad happened to be live the day the deal closed. The outcome belongs
 * to the ad that CREATED the lead, whenever it eventually resolves.
 */
export interface LeadOutcome {
  /** Leads that reached won or lost. Open leads are excluded deliberately. */
  decided: number;
  won: number;
  revenueUsdMinor: number;
}

export interface CandidateMetrics {
  adId: string;
  startedAt: Date;
  daily: DailyMetrics[];
  /** Absent until the business has settled at least some of this ad's leads. */
  leadOutcome?: LeadOutcome;
}

export interface WindowAggregate {
  impressions: number;
  clicks: number;
  intents: number;
  spendUsdMinor: number;
  revenueUsdMinor: number;
}

export type MetricUsed = "roas" | "cost_per_won" | "cpci" | "engagement";

export type Verdict =
  | { status: "pending"; reason: string }
  | {
      status: "decided";
      winnerAdId: string;
      metricUsed: MetricUsed;
      scores: Record<string, number>;
    };

/** Sum the last WINDOW_DAYS of daily metrics relative to `now`. */
export function aggregateWindow(daily: DailyMetrics[], now: Date): WindowAggregate {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const agg: WindowAggregate = {
    impressions: 0,
    clicks: 0,
    intents: 0,
    spendUsdMinor: 0,
    revenueUsdMinor: 0,
  };
  for (const d of daily) {
    if (d.date.getTime() >= cutoff && d.date.getTime() <= now.getTime()) {
      agg.impressions += d.impressions;
      agg.clicks += d.clicks;
      agg.intents += d.intents;
      agg.spendUsdMinor += d.spendUsdMinor;
      agg.revenueUsdMinor += d.revenueUsdMinor;
    }
  }
  return agg;
}

export function isEligible(candidate: CandidateMetrics, now: Date): boolean {
  const hoursLive = (now.getTime() - candidate.startedAt.getTime()) / 3_600_000;
  if (hoursLive < MIN_HOURS) return false;
  return aggregateWindow(candidate.daily, now).impressions >= MIN_IMPRESSIONS;
}

/**
 * Decide the day's winner.
 * A verdict is only issued when EVERY candidate has cleared both thresholds;
 * otherwise the test stays pending (no verdicts on partial data).
 */
export function decideVerdict(
  candidates: CandidateMetrics[],
  opts: {
    storeConnected: boolean;
    /**
     * Manually-reported/pixel revenue may judge (mark-as-sold passed the
     * consistency gate — see tracking/consistency.ts). Store revenue never
     * needs this flag; it arrives automatically and cannot be forgotten.
     */
    revenueTrusted?: boolean;
    now: Date;
  },
): Verdict {
  if (candidates.length < 2) {
    return { status: "pending", reason: "need at least two candidates" };
  }
  const notReady = candidates.filter((c) => !isEligible(c, opts.now));
  if (notReady.length > 0) {
    return {
      status: "pending",
      reason: `waiting on thresholds (>=${MIN_HOURS}h and >=${MIN_IMPRESSIONS} impressions) for: ${notReady
        .map((c) => c.adId)
        .join(", ")}`,
    };
  }

  const aggs = new Map(candidates.map((c) => [c.adId, aggregateWindow(c.daily, opts.now)]));

  // Hierarchy: ROAS when revenue attribution is trustworthy — automatic
  // (store connected) or manual/pixel that passed the consistency gate.
  if (opts.storeConnected || opts.revenueTrusted === true) {
    const scores = scoreBy(aggs, (a) =>
      a.spendUsdMinor > 0 ? a.revenueUsdMinor / a.spendUsdMinor : 0,
    );
    const winner = pickHighest(scores);
    if (winner) return { status: "decided", winnerAdId: winner, metricUsed: "roas", scores };
  }

  // Cost per WON lead — the whole point of asking the owner which leads became
  // customers. It outranks CPCI because CPCI counts enquiries, and the ad that
  // produces the cheapest enquiries is routinely not the one that produces
  // business. Preferring CPCI here would spend the budget on the wrong ad and
  // look rigorous doing it.
  //
  // Requires EVERY candidate to have settled leads, so a slow-to-follow-up week
  // does not hand the duel to whichever ad the owner happened to review first,
  // and at least one win somewhere, because with none the comparison is only
  // between different ways of failing.
  const outcomes = candidates.map((c) => c.leadOutcome);
  const allSettled = outcomes.every(
    (o) => o !== undefined && o.decided >= MIN_DECIDED_LEADS,
  );
  const anyWon = outcomes.some((o) => (o?.won ?? 0) > 0);
  if (allSettled && anyWon) {
    const scores: Record<string, number> = {};
    for (const c of candidates) {
      const won = c.leadOutcome?.won ?? 0;
      const spend = aggs.get(c.adId)?.spendUsdMinor ?? 0;
      // No wins means no cost per win. Infinity sorts last, and two ads that
      // both closed nothing tie — which correctly yields no verdict rather
      // than a coin flip between two failures.
      scores[c.adId] = won > 0 ? spend / won : Number.POSITIVE_INFINITY;
    }
    const winner = pickLowest(scores);
    if (winner) return { status: "decided", winnerAdId: winner, metricUsed: "cost_per_won", scores };
  }

  // CPCI: cost per conversion intent — LOWER is better. Requires intents.
  const allHaveIntents = [...aggs.values()].every((a) => a.intents > 0);
  if (allHaveIntents) {
    const scores = scoreBy(aggs, (a) => a.spendUsdMinor / a.intents);
    const winner = pickLowest(scores);
    if (winner) return { status: "decided", winnerAdId: winner, metricUsed: "cpci", scores };
  }

  // Engagement tiebreaker: click-through rate — higher is better.
  const scores = scoreBy(aggs, (a) => (a.impressions > 0 ? a.clicks / a.impressions : 0));
  const winner = pickHighest(scores);
  if (winner) return { status: "decided", winnerAdId: winner, metricUsed: "engagement", scores };

  return { status: "pending", reason: "no discriminating metric available" };
}

function scoreBy(
  aggs: Map<string, WindowAggregate>,
  fn: (a: WindowAggregate) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, agg] of aggs) out[id] = fn(agg);
  return out;
}

function pickHighest(scores: Record<string, number>): string | null {
  return pickBy(scores, (a, b) => b - a);
}
function pickLowest(scores: Record<string, number>): string | null {
  return pickBy(scores, (a, b) => a - b);
}
function pickBy(
  scores: Record<string, number>,
  cmp: (a: number, b: number) => number,
): string | null {
  const entries = Object.entries(scores).sort((x, y) => cmp(x[1], y[1]));
  if (entries.length === 0) return null;
  // A tie means the data cannot discriminate — no verdict on a coin flip.
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return null;
  return entries[0][0];
}
