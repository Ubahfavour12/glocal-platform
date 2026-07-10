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
  if (!Number.isInteger(challengerCount) || challengerCount < 1) {
    throw new Error("challengerCount must be a positive integer");
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
