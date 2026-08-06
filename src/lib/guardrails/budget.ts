/**
 * Budget guardrails — Blueprint §4.3.
 * "No ad set's budget ever increases by more than 30% in a 24-hour cycle,
 * in any persona. This cap is enforced in code, not in the prompt."
 */

export const MAX_DAILY_INCREASE_BPS = 3_000; // +30% per 24h cycle, hard cap

export type PersonaMode = "conservative" | "smart" | "aggressive";

/**
 * Champion share of the daily budget per Scaling Persona (Blueprint §4.3),
 * in basis points — integers only, so splits are float-safe.
 */
export const PERSONA_CHAMPION_SHARE_BPS: Record<PersonaMode, number> = {
  conservative: 8_000,
  smart: 7_000, // Dynamic Split 70/30 — the default
  aggressive: 6_000,
};

/**
 * Clamp a proposed next-day budget against the 30% escalation cap.
 * Decreases are always allowed; increases are capped at current × 1.30.
 */
export function clampBudgetIncrease(
  currentUsdMinor: number,
  proposedUsdMinor: number,
): number {
  assertPositiveMinor(currentUsdMinor, "current budget");
  assertNonNegativeMinor(proposedUsdMinor, "proposed budget");
  const cap = Math.floor(currentUsdMinor * (1 + MAX_DAILY_INCREASE_BPS / 10_000));
  return Math.min(proposedUsdMinor, cap);
}

/**
 * The least a challenger can be given and still learn anything. Below this a
 * new ad cannot gather enough impressions to reach the duel's own verdict
 * threshold, so it would run forever without ever being judged. Starving two
 * challengers is strictly worse than funding one properly.
 */
export const MIN_CHALLENGER_USD_MINOR = 300; // $3/day

export interface ChallengerPlan {
  /** How many challengers can actually be funded today (0, 1 or `desired`). */
  count: number;
  /** Plain-language explanation when we could not run the full duel. */
  note: string | null;
}

/**
 * How many challengers today's budget can genuinely support.
 *
 * Persona-agnostic on purpose: it works from the real challenger pool rather
 * than fixed budget thresholds, so it stays correct if the persona shares ever
 * change. Returns 0 when even one challenger cannot be funded — in that case
 * the whole budget goes to the champion and the customer is told why.
 */
export function viableChallengerCount(
  totalUsdMinor: number,
  persona: PersonaMode,
  desiredCount = 2,
): ChallengerPlan {
  assertPositiveMinor(totalUsdMinor, "total budget");
  const challengerShareBps = 10_000 - PERSONA_CHAMPION_SHARE_BPS[persona];
  const pool = Math.floor((totalUsdMinor * challengerShareBps) / 10_000);
  const affordable = Math.floor(pool / MIN_CHALLENGER_USD_MINOR);
  const count = Math.max(0, Math.min(desiredCount, affordable));

  if (count === desiredCount) return { count, note: null };

  const needForFull = Math.ceil(
    (MIN_CHALLENGER_USD_MINOR * desiredCount * 10_000) / challengerShareBps / 100,
  );
  if (count === 0) {
    return {
      count: 0,
      note: `Your daily budget is too small to test a new ad properly, so today everything goes to your best performer. Raise it to about $${needForFull}/day and I'll start testing ${desiredCount} new ads against it every day.`,
    };
  }
  return {
    count,
    note: `At this budget I can test ${count} new ad${count === 1 ? "" : "s"} a day instead of ${desiredCount}, so it gets enough spend to actually prove itself. Raise to about $${needForFull}/day for the full daily test.`,
  };
}

export interface BudgetSplit {
  championUsdMinor: number;
  /** One entry per challenger, equal split, remainder to the champion. */
  challengerUsdMinor: number[];
}

/**
 * Split the day's budget between champion and challengers per persona.
 * Integer-exact: the pieces always sum to the total (rounding remainder
 * goes to the champion).
 */
export function personaSplit(
  totalUsdMinor: number,
  persona: PersonaMode,
  challengerCount = 2,
): BudgetSplit {
  assertPositiveMinor(totalUsdMinor, "total budget");
  if (!Number.isInteger(challengerCount) || challengerCount < 0) {
    throw new Error("challengerCount must be a non-negative integer");
  }
  // No affordable challenger today: the champion carries the whole budget.
  if (challengerCount === 0) {
    return { championUsdMinor: totalUsdMinor, challengerUsdMinor: [] };
  }
  const challengerShareBps = 10_000 - PERSONA_CHAMPION_SHARE_BPS[persona];
  const challengerPool = Math.floor((totalUsdMinor * challengerShareBps) / 10_000);
  const perChallenger = Math.floor(challengerPool / challengerCount);
  const challengers = Array.from({ length: challengerCount }, () => perChallenger);
  const champion = totalUsdMinor - perChallenger * challengerCount;
  return { championUsdMinor: champion, challengerUsdMinor: challengers };
}

function assertPositiveMinor(n: number, label: string): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer of USD minor units, got ${n}`);
  }
}
function assertNonNegativeMinor(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer of USD minor units, got ${n}`);
  }
}
