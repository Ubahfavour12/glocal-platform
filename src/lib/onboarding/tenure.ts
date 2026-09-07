/**
 * How long a business has been trading.
 *
 * Collected once at onboarding as a single year, because that is what an owner
 * can answer without inventing anything. A day and month would look more
 * precise and be less true.
 *
 * It gates nothing. It exists so churn can be read against tenure: a shop three
 * months old that leaves and a shop of fifteen years that leaves are not the
 * same event, and treating them as one number hides the only interesting part.
 */

/** Nothing before this is a plausible trading business; below it is a typo. */
export const EARLIEST_FOUNDED_YEAR = 1800;

export type TenureBand = "new" | "establishing" | "established" | "institution";

/**
 * Is this a year a business could have started trading?
 *
 * The future is rejected outright: a business cannot have started in a year
 * that has not happened, and accepting it would quietly corrupt every tenure
 * figure derived from it.
 */
export function isValidFoundedYear(year: number, now: Date = new Date()): boolean {
  if (!Number.isInteger(year)) return false;
  return year >= EARLIEST_FOUNDED_YEAR && year <= now.getFullYear();
}

/** Years trading, or null when the question was not answered. */
export function tenureYears(
  foundedYear: number | null | undefined,
  now: Date = new Date(),
): number | null {
  if (typeof foundedYear !== "number" || !isValidFoundedYear(foundedYear, now)) return null;
  return now.getFullYear() - foundedYear;
}

/**
 * Tenure as a band, for reading retention by cohort.
 *
 * The boundaries are about survival odds, not roundness. Year one is where
 * most businesses fail, so it stands alone. Anything past a decade has
 * outlasted almost everything and behaves differently again.
 */
export function tenureBand(
  foundedYear: number | null | undefined,
  now: Date = new Date(),
): TenureBand | null {
  const years = tenureYears(foundedYear, now);
  if (years === null) return null;
  if (years < 1) return "new";
  if (years < 3) return "establishing";
  if (years < 10) return "established";
  return "institution";
}

/** How the agent refers to it in copy. Never patronising about a new business. */
export const TENURE_LABEL: Record<TenureBand, string> = {
  new: "first year",
  establishing: "1–3 years",
  established: "3–10 years",
  institution: "10+ years",
};
