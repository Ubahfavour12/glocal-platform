/**
 * A/B verdict engine — Blueprint §4.2.
 * - Verdict threshold: minimum 24 hours AND 5,000 impressions per candidate.
 * - Evaluation window: rolling 3 days (absorbs attribution lag).
 * - Metric hierarchy: ROAS (store connected) → CPCI → engagement tiebreaker.
 * Never early-kills on thin data.
 */

export const MIN_HOURS = 24;
export const MIN_IMPRESSIONS = 5_000;
export const WINDOW_DAYS = 3;

export interface DailyMetrics {
  date: Date;
  impressions: number;
  clicks: number;
  /** Conversion intents: WhatsApp opens, calls, store sessions. */
  intents: number;
  spendUsdMinor: number;
  revenueUsdMinor: number;
}

export interface CandidateMetrics {
  adId: string;
  startedAt: Date;
  daily: DailyMetrics[];
}

export interface WindowAggregate {
  impressions: number;
  clicks: number;
  intents: number;
  spendUsdMinor: number;
  revenueUsdMinor: number;
}

export type MetricUsed = "roas" | "cpci" | "engagement";

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
  opts: { storeConnected: boolean; now: Date },
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

  // Hierarchy: ROAS when a store is connected and revenue attribution exists.
  if (opts.storeConnected) {
    const scores = scoreBy(aggs, (a) =>
      a.spendUsdMinor > 0 ? a.revenueUsdMinor / a.spendUsdMinor : 0,
    );
    const winner = pickHighest(scores);
    if (winner) return { status: "decided", winnerAdId: winner, metricUsed: "roas", scores };
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
