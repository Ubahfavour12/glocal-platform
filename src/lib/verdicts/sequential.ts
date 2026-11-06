/**
 * Sequential A/B — how Spark learns without being able to afford a duel.
 *
 * THE PROBLEM. The duel is PARALLEL A/B: two ad sets funded at the same time,
 * which needs two budgets at once. `MIN_CHALLENGER_USD_MINOR` is $3/day and the
 * default persona splits 70/30, so below $10/day the challenger pool cannot
 * fund even one challenger. That is where the $10/day floor came from, and it
 * is why a micro business could run ads here but never learn anything from
 * them.
 *
 * Sequential A/B needs one budget. Run ad A for a block of days, then ad B for
 * a block, and compare the blocks. That is the entire idea, and it is the only
 * way the bottom of the market gets a verdict at all.
 *
 * THE WEAKNESS, STATED UP FRONT. A duel compares two ads under identical
 * conditions, because they ran at the same moment. Sequential does not: A ran
 * last week and B ran this week, so ANY difference between those weeks is
 * mixed into the result. Payday, a holiday, a competitor's promotion, rain,
 * a viral moment in the category — none of it is controlled for, and no amount
 * of arithmetic here can separate it from the creative.
 *
 * So this module does three things the duel does not need to:
 *
 *   1. REQUIRES WHOLE WEEKS. A block must be a multiple of 7 days. That is not
 *      arbitrary: weekend trade is not weekday trade, and a block of Mon-Thu
 *      against a block of Fri-Mon compares days of the week as much as ads.
 *      Whole weeks make the weekday composition identical by construction,
 *      which removes the single largest confounder for free.
 *   2. CHECKS THE BLOCKS MATCH. Same length, both over the impression
 *      threshold. An ad that ran twice as long is not a fair comparison.
 *   3. NAMES WHAT IT COULD NOT CONTROL. Every result carries caveats and a
 *      confidence that is never higher than "moderate". A sequential verdict
 *      must not be reported in the same voice as a duel's, because the
 *      evidence genuinely is weaker, and a customer acting on it should know
 *      that.
 *
 * The metric hierarchy itself is NOT reimplemented here — it calls
 * `pickWinner` from verdict.ts. A second copy would drift, and the copy that
 * drifted would be the cheap tier's, which is the one nobody is watching.
 */

import {
  MIN_IMPRESSIONS,
  pickWinner,
  type CandidateMetrics,
  type DailyMetrics,
  type MetricUsed,
  type WindowAggregate,
} from "./verdict";

/**
 * A block must be whole weeks, so both blocks contain each weekday equally
 * often. Seven days is also roughly the shortest run that gives a small
 * budget time to clear the impression threshold.
 */
export const DAYS_PER_WEEK = 7;
export const MIN_BLOCK_DAYS = DAYS_PER_WEEK;

/** One ad's run: the days it was live, in any order. */
export interface SequentialBlock {
  adId: string;
  daily: DailyMetrics[];
}

export type Confidence = "low" | "moderate";

export interface SequentialVerdict {
  status: "pending" | "decided";
  /** Always present, always plain language, for the journal and the customer. */
  reason: string;
  winnerAdId?: string;
  metricUsed?: MetricUsed;
  scores?: Record<string, number>;
  /** Never higher than "moderate". Sequential evidence is weaker than a duel's. */
  confidence?: Confidence;
  /** Confounders this comparison could not rule out. Never empty on a decision. */
  caveats: string[];
}

/** Distinct calendar days in a block. Duplicates collapse. */
export function blockDays(b: SequentialBlock): number {
  return new Set(b.daily.map((d) => d.date.toISOString().slice(0, 10))).size;
}

/** Pure: how many of each weekday a block covers, indexed 0 (Sun) to 6 (Sat). */
export function weekdayHistogram(b: SequentialBlock): number[] {
  const seen = new Set<string>();
  const counts = new Array(7).fill(0) as number[];
  for (const d of b.daily) {
    const key = d.date.toISOString().slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    counts[d.date.getUTCDay()] += 1;
  }
  return counts;
}

/**
 * Pure: the worst weekday mismatch between two blocks.
 *
 * Zero means each block contains every weekday the same number of times, so
 * the comparison is not secretly a weekday comparison. Whole-week blocks give
 * zero automatically; this catches the case where they do not.
 */
export function weekdayImbalance(a: SequentialBlock, b: SequentialBlock): number {
  const ha = weekdayHistogram(a);
  const hb = weekdayHistogram(b);
  return Math.max(...ha.map((n, i) => Math.abs(n - hb[i])));
}

/** Sum a whole block. Unlike the duel's window, nothing is cut off by date. */
export function aggregateBlock(b: SequentialBlock): WindowAggregate {
  const agg: WindowAggregate = {
    impressions: 0,
    clicks: 0,
    intents: 0,
    spendUsdMinor: 0,
    revenueUsdMinor: 0,
    reach: 0,
    attention: { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 },
  };
  for (const d of b.daily) {
    agg.impressions += d.impressions;
    agg.clicks += d.clicks;
    agg.intents += d.intents;
    agg.spendUsdMinor += d.spendUsdMinor;
    agg.revenueUsdMinor += d.revenueUsdMinor;
    agg.reach += d.reach ?? 0;
    if (d.attention) {
      agg.attention.saves += d.attention.saves;
      agg.attention.shares += d.attention.shares;
      agg.attention.comments += d.attention.comments;
      agg.attention.reactions += d.attention.reactions;
      agg.attention.thruPlays += d.attention.thruPlays;
    }
  }
  return agg;
}

/** Pure: the caveats that always apply to a comparison across time. */
function standingCaveats(a: SequentialBlock, b: SequentialBlock): string[] {
  const out = [
    "These two ads ran at different times, so anything that changed between them — payday, a holiday, the weather, a competitor's promotion — is mixed into this result. A side-by-side test does not have that problem.",
  ];
  if (weekdayImbalance(a, b) > 0) {
    out.push(
      "The two runs did not cover the same days of the week, so part of this difference may be the days rather than the ads.",
    );
  }
  return out;
}

/**
 * Decide between two sequential blocks.
 *
 * Deliberately stricter than the duel about when it will answer at all, and
 * deliberately quieter when it does. A small business acting on a weak signal
 * is spending money it has little of, so the bar to speak is higher here, not
 * lower.
 */
export function decideSequential(
  blocks: SequentialBlock[],
  opts: { storeConnected: boolean; revenueTrusted?: boolean; awareness?: boolean },
): SequentialVerdict {
  if (blocks.length !== 2) {
    return {
      status: "pending",
      reason: "sequential testing compares exactly two runs; waiting for the second ad to finish its turn",
      caveats: [],
    };
  }
  const [a, b] = blocks;
  const daysA = blockDays(a);
  const daysB = blockDays(b);

  const tooShort = [
    { id: a.adId, days: daysA },
    { id: b.adId, days: daysB },
  ].filter((x) => x.days < MIN_BLOCK_DAYS);
  if (tooShort.length > 0) {
    return {
      status: "pending",
      reason: `each ad needs at least ${MIN_BLOCK_DAYS} days before the runs can be compared; ${tooShort
        .map((x) => `${x.id} has ${x.days}`)
        .join(", ")}`,
      caveats: [],
    };
  }

  // Whole weeks only. A part-week block makes the comparison partly a
  // comparison of which days of the week each ad happened to get.
  const ragged = [daysA, daysB].some((d) => d % DAYS_PER_WEEK !== 0);
  if (ragged) {
    return {
      status: "pending",
      reason: `runs are compared in whole weeks, so that both ads get the same weekdays; this pair is ${daysA} and ${daysB} days`,
      caveats: [],
    };
  }

  if (daysA !== daysB) {
    return {
      status: "pending",
      reason: `the two runs are different lengths (${daysA} days vs ${daysB}), which is not a fair comparison; they will be matched before judging`,
      caveats: [],
    };
  }

  const aggs = new Map([
    [a.adId, aggregateBlock(a)],
    [b.adId, aggregateBlock(b)],
  ]);

  const thin = [...aggs.entries()].filter(([, agg]) => agg.impressions < MIN_IMPRESSIONS);
  if (thin.length > 0) {
    return {
      status: "pending",
      reason: `not enough people have seen ${thin
        .map(([id]) => id)
        .join(" and ")} yet (need ${MIN_IMPRESSIONS.toLocaleString()} views each)`,
      caveats: [],
    };
  }

  // Same hierarchy as the duel. `startedAt` and `daily` are not read by
  // pickWinner, but CandidateMetrics requires them, so they are filled from
  // the block rather than faked.
  const candidates: CandidateMetrics[] = [a, b].map((blk) => ({
    adId: blk.adId,
    startedAt: blk.daily.reduce(
      (min, d) => (d.date < min ? d.date : min),
      blk.daily[0]?.date ?? new Date(0),
    ),
    daily: blk.daily,
  }));

  const verdict = pickWinner(aggs, candidates, opts);
  const caveats = standingCaveats(a, b);

  if (verdict.status !== "decided") {
    return { status: "pending", reason: verdict.reason, caveats: [] };
  }

  return {
    status: "decided",
    reason: `Over ${daysA} days each, ${verdict.winnerAdId} did better. This is a before-and-after comparison, not a head-to-head, so treat it as a lead worth following rather than a settled answer.`,
    winnerAdId: verdict.winnerAdId,
    metricUsed: verdict.metricUsed,
    scores: verdict.scores,
    // Never "high". Two runs separated in time cannot earn that, however
    // clean the numbers look.
    confidence: daysA >= DAYS_PER_WEEK * 2 ? "moderate" : "low",
    caveats,
  };
}
