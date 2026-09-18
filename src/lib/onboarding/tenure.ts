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

/**
 * What tenure tells the ad writer.
 *
 * Until now this was collected at onboarding and used for nothing. That is a
 * waste of the one fact every owner can answer instantly and that genuinely
 * changes what an ad should say: a shop trading fifteen years and one trading
 * three months are selling the same product to the same people and cannot
 * honestly use the same angle.
 *
 * The guidance is written as constraints rather than slogans, because the model
 * writes better from "do not claim X, you have Y instead" than from an adjective.
 *
 * NOTHING HERE IS PATRONISING ABOUT A NEW BUSINESS, and nothing invites a claim
 * the business cannot back. A new shop must not imply a track record it does
 * not have — that is how ad accounts get banned and how customers get lied to.
 */
export const TENURE_GUIDANCE: Record<TenureBand, string> = {
  new: "This business is in its first year. Do NOT imply a track record, years of experience, or a large existing customer base, because it does not have one and the claim would be false. Lean on what is actually true of a new business: the owner is personally reachable, the care is obvious, and being new is a reason to be tried, not hidden.",
  establishing:
    "This business has been trading one to three years. It has real customers but is not an institution. It can honestly mention repeat buyers and word of mouth; it should not claim decades or market leadership.",
  established:
    "This business has been trading three to ten years. It has survived long enough that reliability is its own argument. Use it: consistency, people who keep coming back, knowing the product properly. It is not an heirloom brand.",
  institution:
    "This business has been trading over ten years. Longevity is its single strongest and least copyable asset, and most ads waste it. Say how long, plainly, early. In a market where sellers appear and vanish, having been there a decade is the whole pitch.",
};

/**
 * The line the concept prompt receives, or nothing.
 *
 * Returns an empty string when the year was not given, so an unanswered
 * question adds nothing to the prompt rather than adding a hedge. A model told
 * "tenure unknown" will write around the uncertainty, which is worse than not
 * raising it.
 */
export function tenureGuidance(
  foundedYear: number | null | undefined,
  now: Date = new Date(),
): string {
  const band = tenureBand(foundedYear, now);
  if (band === null) return "";
  const years = tenureYears(foundedYear, now);
  return `BUSINESS AGE: trading ${years === 0 ? "less than a year" : `${years} year${years === 1 ? "" : "s"}`} (${TENURE_LABEL[band]}).\n${TENURE_GUIDANCE[band]}`;
}
