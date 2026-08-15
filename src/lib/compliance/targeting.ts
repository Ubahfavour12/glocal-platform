/**
 * Audience constraints the ad networks require for restricted categories.
 *
 * The Compliance Gateway has always flagged that alcohol "requires age-gated
 * delivery ... orchestrator must apply age/geo constraints". Nothing ever
 * applied them: every ad set went to Meta carrying geo_locations and nothing
 * else. An alcohol ad without an age floor is rejected on review at best, and
 * at worst puts the ad account at risk, which would take every campaign on it
 * down. The wine dogfood would have hit this immediately.
 *
 * Deliberately narrow: this sets only the constraints a network REQUIRES. It is
 * not interest or demographic targeting, which the product avoids on purpose
 * (Creative-Led Broad Targeting: the creative finds the audience, and narrowing
 * an audience raises costs and starves the algorithm of learning).
 */

/** Legal purchase age by country, for age-restricted goods. */
const DRINKING_AGE: Record<string, number> = {
  US: 21,
  CA: 19,
  JP: 20,
  KR: 19,
  IS: 20,
  PY: 20,
};

/** Everywhere else we serve, and Meta's own floor. */
const DEFAULT_RESTRICTED_AGE = 18;

/** Markets where alcohol advertising is prohibited outright. */
const ALCOHOL_PROHIBITED = new Set(["SA", "AE", "KW", "QA", "LY", "PK", "BN", "AF", "IR", "YE"]);

const AGE_RESTRICTED = /\b(wine|alcohol|spirit|spirits|beer|liquor|vodka|whisky|whiskey|rum|gin|champagne|brandy|cider)\b/i;
const ADULT_ONLY = /\b(dating|gambling|betting|casino)\b/i;

export interface AudienceConstraints {
  /** Minimum age Meta must enforce, or undefined when unrestricted. */
  ageMin?: number;
  /** Countries removed because the category cannot be advertised there. */
  blockedCountries: string[];
  /** Countries the ad may actually run in. */
  countries: string[];
  /** Plain-language note for the journal when something was constrained. */
  note: string | null;
}

/**
 * Work out what a category requires for a given set of target countries.
 *
 * Returns the countries actually usable, so a business selling wine into a
 * prohibited market does not silently burn budget on ads that cannot run.
 */
export function audienceConstraintsFor(
  category: string,
  countries: readonly string[],
): AudienceConstraints {
  const cat = (category ?? "").toLowerCase();
  const isAlcohol = AGE_RESTRICTED.test(cat);
  const isAdultOnly = ADULT_ONLY.test(cat);

  if (!isAlcohol && !isAdultOnly) {
    return { blockedCountries: [], countries: [...countries], note: null };
  }

  const blocked = isAlcohol
    ? countries.filter((c) => ALCOHOL_PROHIBITED.has(c.toUpperCase()))
    : [];
  const allowed = countries.filter((c) => !blocked.includes(c));

  // The strictest requirement across every remaining market wins: one ad set
  // serves them all, so the floor has to satisfy the toughest one.
  const ageMin = allowed.reduce(
    (max, c) => Math.max(max, DRINKING_AGE[c.toUpperCase()] ?? DEFAULT_RESTRICTED_AGE),
    DEFAULT_RESTRICTED_AGE,
  );

  const parts: string[] = [];
  if (ageMin > 0) parts.push(`age-gated to ${ageMin}+ as this category requires`);
  if (blocked.length > 0) {
    parts.push(`removed ${blocked.join(", ")} where this cannot be advertised`);
  }

  return {
    ageMin,
    blockedCountries: blocked,
    countries: allowed,
    note: parts.length > 0 ? `I ${parts.join(", and ")}.` : null,
  };
}
