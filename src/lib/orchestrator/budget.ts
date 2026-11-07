/**
 * How long the nightly run may keep going.
 *
 * THE FAILURE THIS PREVENTS. Both job routes declare `maxDuration = 300` and
 * then loop over every business with no idea how much of that they have spent.
 * When the ceiling arrives the lambda is KILLED -- mid-business, mid-write,
 * with no response, no summary and no record of how far it got. The customers
 * after the cut-off simply did not happen, and because the query had no
 * ORDER BY, they were the same customers the night before.
 *
 * Stopping voluntarily a little early turns that into something a person can
 * act on: the run returns, says who was deferred, and the ones it did not
 * reach sort to the front of tomorrow's queue because their `last_run_at` is
 * older. Nothing is lost; it is just late.
 *
 * The reserve is the point. Checking "have I hit 300 seconds" is useless --
 * you need the time to WRITE THE ANSWER DOWN and return a response. So the
 * loop stops when there is not enough left for another business plus the
 * reserve.
 */

/** Vercel's ceiling for these routes, mirrored from their `maxDuration`. */
export const JOB_CEILING_MS = 300_000;

/**
 * Held back for finishing up: the audit write and the JSON response.
 *
 * Generous rather than tight. Being killed is far worse than stopping one
 * business early, and that asymmetry should be visible in the number.
 */
export const RESERVE_MS = 20_000;

/**
 * What one business is assumed to need.
 *
 * A guess, and it is allowed to be: it is only used to decide whether to
 * START another one. Too high defers work that would have fitted; too low
 * gets the run killed, which is the outcome this file exists to avoid. So it
 * is deliberately pessimistic.
 */
export const PER_BUSINESS_MS = 25_000;

export interface BudgetInput {
  /** When the run began, as epoch milliseconds. */
  startedAtMs: number;
  /** Now, as epoch milliseconds. */
  nowMs: number;
  /** Override the ceiling; defaults to the route's maxDuration. */
  ceilingMs?: number;
  /** Override the per-business estimate, e.g. from observed timings. */
  perBusinessMs?: number;
}

/**
 * Is there room to start another business?
 *
 * Pure and total, so the decision can be tested without burning five minutes
 * of wall clock.
 */
export function hasRoomForAnother(input: BudgetInput): boolean {
  const ceiling = input.ceilingMs ?? JOB_CEILING_MS;
  const per = input.perBusinessMs ?? PER_BUSINESS_MS;
  const elapsed = input.nowMs - input.startedAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return true; // a nonsense clock must not halt the run
  return elapsed + per + RESERVE_MS <= ceiling;
}

/**
 * How long one business actually took, folded into a running average.
 *
 * Starting from the pessimistic constant and moving toward what is really
 * happening means a fast night fits more businesses in and a slow night
 * defers sooner, without anyone tuning a number by hand.
 */
export function observedPerBusinessMs(
  completed: number,
  elapsedMs: number,
  fallback = PER_BUSINESS_MS,
): number {
  if (completed <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return fallback;
  // Never let the estimate drop below a floor: three fast businesses in a row
  // must not convince the loop that the next one is free.
  return Math.max(2_000, Math.round(elapsedMs / completed));
}
