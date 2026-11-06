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
  /**
   * Unique people reached. Optional because it was never fetched before the
   * awareness work, so historical rows and older fixtures do not carry it.
   */
  reach?: number;
  /** Attention events, for awareness goals. Optional for the same reason. */
  attention?: AttentionCounts;
}

/** Attention events, mirroring meta/insights.ts. */
export interface AttentionCounts {
  saves: number;
  shares: number;
  comments: number;
  reactions: number;
  thruPlays: number;
}

/**
 * What each attention event is worth, relative to each other.
 *
 * A FOUNDER JUDGEMENT, NOT A MEASUREMENT, and labelled so deliberately -- the
 * same way router.ts labels its routing assumption. Nobody has correlated
 * these against brand outcomes because that needs survey data this product
 * does not collect.
 *
 * The ordering is the defensible part. A save and a share cost the viewer
 * something: a save is a decision to come back, a share puts their own name
 * behind it in front of their own friends. A reaction costs a tap and is what
 * bait farms, so it counts least. ThruPlay sits between: watching 15 seconds
 * of an ad is real attention, but it is passive.
 *
 * If this is ever measured, the weights move and the metric name does not.
 */
export const ATTENTION_WEIGHTS: Record<keyof AttentionCounts, number> = {
  shares: 5,
  saves: 4,
  comments: 2,
  thruPlays: 2,
  reactions: 1,
};

/**
 * Above this, the budget is mostly re-showing the ad to people who have
 * already seen it. Three is the number media buyers reach for; it is a rule of
 * thumb rather than a finding, and the engine reports it rather than acting on
 * it alone.
 */
export const FREQUENCY_CEILING = 3;

/** Pure: the weighted attention score for one window. */
export function attentionScore(a: AttentionCounts | undefined): number {
  if (!a) return 0;
  return (
    a.shares * ATTENTION_WEIGHTS.shares +
    a.saves * ATTENTION_WEIGHTS.saves +
    a.comments * ATTENTION_WEIGHTS.comments +
    a.thruPlays * ATTENTION_WEIGHTS.thruPlays +
    a.reactions * ATTENTION_WEIGHTS.reactions
  );
}

/** Pure: impressions per person reached. Null when reach is unknown or zero. */
export function frequencyOf(agg: { impressions: number; reach: number }): number | null {
  return agg.reach > 0 ? agg.impressions / agg.reach : null;
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
  /** Summed unique reach. An over-count across days; see aggregateWindow. */
  reach: number;
  attention: AttentionCounts;
}

export type MetricUsed = "roas" | "cost_per_won" | "cpci" | "attention" | "engagement";

export type Verdict =
  | { status: "pending"; reason: string }
  | {
      status: "decided";
      winnerAdId: string;
      metricUsed: MetricUsed;
      scores: Record<string, number>;
    };

/**
 * Pure: which candidates are showing to the same people too often.
 *
 * Reported rather than acted on. A saturated ad is a reason to widen the
 * audience, and the engine saying so is more useful than it silently
 * discarding the only data it has.
 */
export function saturatedAds(
  aggs: Map<string, WindowAggregate>,
  ceiling = FREQUENCY_CEILING,
): string[] {
  const out: string[] = [];
  for (const [adId, agg] of aggs) {
    const f = frequencyOf(agg);
    if (f !== null && f > ceiling) out.push(adId);
  }
  return out;
}

/** Sum the last WINDOW_DAYS of daily metrics relative to `now`. */
export function aggregateWindow(daily: DailyMetrics[], now: Date): WindowAggregate {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const agg: WindowAggregate = {
    impressions: 0,
    clicks: 0,
    intents: 0,
    spendUsdMinor: 0,
    revenueUsdMinor: 0,
    reach: 0,
    attention: { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 },
  };
  for (const d of daily) {
    if (d.date.getTime() >= cutoff && d.date.getTime() <= now.getTime()) {
      agg.impressions += d.impressions;
      agg.clicks += d.clicks;
      agg.intents += d.intents;
      agg.spendUsdMinor += d.spendUsdMinor;
      agg.revenueUsdMinor += d.revenueUsdMinor;
      // Summing daily reach over-counts anyone reached on more than one day.
      // Meta only de-duplicates reach within a single query window, and asking
      // per-window would double the API calls. Both candidates are inflated by
      // the same mechanism, so a COMPARISON between them stays fair, which is
      // all the duel needs -- but this number must never be shown to a
      // customer as "people reached".
      agg.reach += d.reach ?? 0;
      if (d.attention) {
        agg.attention.saves += d.attention.saves;
        agg.attention.shares += d.attention.shares;
        agg.attention.comments += d.attention.comments;
        agg.attention.reactions += d.attention.reactions;
        agg.attention.thruPlays += d.attention.thruPlays;
      }
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
     * True when this business's goal is awareness. Awareness changes which
     * metric is allowed to decide, not merely which is preferred.
     */
    awareness?: boolean;
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
  return pickWinner(aggs, candidates, opts);
}

/**
 * Apply the metric hierarchy to already-aggregated candidates.
 *
 * Split out of decideVerdict so sequential testing (verdicts/sequential.ts)
 * uses the SAME hierarchy rather than a second copy of it. Two copies would
 * drift, and the one that drifted would be the one nobody was looking at --
 * the cheap tier's.
 *
 * Takes aggregates rather than computing them, because the duel sums a rolling
 * window ending now while a sequential block sums a fixed past period. That is
 * the only real difference between the two; everything below is shared.
 */
export function pickWinner(
  aggs: Map<string, WindowAggregate>,
  candidates: CandidateMetrics[],
  opts: { storeConnected: boolean; revenueTrusted?: boolean; awareness?: boolean },
): Verdict {

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

  // ATTENTION — awareness only, and placed here deliberately.
  //
  // An awareness ad is not trying to be clicked. Before this branch existed,
  // an awareness duel fell past ROAS, cost-per-won and CPCI (all of which need
  // conversions an awareness campaign does not produce) and landed on the CTR
  // tiebreaker -- so the agent would reliably crown whichever ad was best at
  // baiting a click, and move real budget onto it, while reporting a clean
  // verdict. That is worse than no verdict: it is a confident wrong answer.
  //
  // Cost per weighted attention event, LOWER is better. It stays a cost metric
  // so the cheap-but-ignored ad cannot win on volume alone.
  if (opts.awareness) {
    const scored = candidates.map((c) => {
      const agg = aggs.get(c.adId);
      return { adId: c.adId, score: attentionScore(agg?.attention), spend: agg?.spendUsdMinor ?? 0 };
    });
    if (scored.every((s) => s.score > 0)) {
      const scores: Record<string, number> = {};
      for (const s of scored) scores[s.adId] = s.spend / s.score;
      const winner = pickLowest(scores);
      if (winner) return { status: "decided", winnerAdId: winner, metricUsed: "attention", scores };
    }
    // No attention data on every candidate. Falling through to CTR here would
    // reintroduce exactly the bug this branch exists to fix, so an awareness
    // duel stops rather than answering with the wrong question.
    return {
      status: "pending",
      reason:
        "awareness duel needs saves, shares, comments or video views on every ad before it can be judged; clicks are not what this ad is buying",
    };
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
