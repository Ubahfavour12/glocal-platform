/**
 * Where a business's ads should run.
 *
 * This existed as free text ("Lagos", "Accra and Kumasi") that nothing ever
 * read: the launcher looked for a `countries` array, never found one, and fell
 * back to Nigeria for everyone. A business in Ghana was having its money spent
 * showing ads in a country it does not sell to. Targeting is money, so it
 * resolves from the most reliable signal available.
 *
 * Resolution order, most to least trustworthy:
 *   1. countries explicitly stored on the geo object
 *   2. the country captured at signup (a picked value, not typed prose)
 *   3. country names recognised in the free text
 *   4. Nigeria, the first market
 *
 * Pure, so targeting can be verified without a database or Meta.
 */

export interface ServiceGeo {
  /** What the owner typed, kept verbatim for display and future parsing. */
  raw?: string;
  /** ISO-3166 alpha-2 codes. */
  countries?: string[];
  /** Free-text place names inside those countries, for later city targeting. */
  cities?: string[];
}

/** Countries we can currently serve, by the names people actually type. */
const COUNTRY_BY_NAME: Record<string, string> = {
  nigeria: "NG",
  ghana: "GH",
  kenya: "KE",
  "south africa": "ZA",
  uganda: "UG",
  tanzania: "TZ",
  rwanda: "RW",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  senegal: "SN",
  cameroon: "CM",
  egypt: "EG",
  morocco: "MA",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  "united states": "US",
  usa: "US",
  us: "US",
  canada: "CA",
  ireland: "IE",
};

/** Well-known cities, so "Lagos" alone still resolves to a country. */
const COUNTRY_BY_CITY: Record<string, string> = {
  lagos: "NG",
  abuja: "NG",
  "port harcourt": "NG",
  ibadan: "NG",
  kano: "NG",
  benin: "NG",
  accra: "GH",
  kumasi: "GH",
  nairobi: "KE",
  mombasa: "KE",
  johannesburg: "ZA",
  "cape town": "ZA",
  durban: "ZA",
  kampala: "UG",
  "dar es salaam": "TZ",
  kigali: "RW",
  london: "GB",
  manchester: "GB",
  bristol: "GB",
};

const ISO = /^[A-Z]{2}$/;

/** Pure: country codes we can recognise in a line of free text. */
export function countriesFromText(text: string): string[] {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return [];
  const found = new Set<string>();
  // Longer names first so "south africa" is not matched as a stray "africa".
  for (const [name, code] of Object.entries(COUNTRY_BY_NAME).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (t.includes(name)) found.add(code);
  }
  for (const [city, code] of Object.entries(COUNTRY_BY_CITY)) {
    if (t.includes(city)) found.add(code);
  }
  return [...found];
}

/** Pure: place names in the text that we know, for future city targeting. */
export function citiesFromText(text: string): string[] {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return [];
  return Object.keys(COUNTRY_BY_CITY)
    .filter((city) => t.includes(city))
    .map((city) => city.replace(/\b\w/g, (c) => c.toUpperCase()));
}

/**
 * Resolve the countries an account's ads should target.
 *
 * `signupCountry` is weighted above parsed text because it was chosen from a
 * list rather than typed, so it cannot be a misspelling or an ambiguity.
 */
export function resolveTargetCountries(
  geo: unknown,
  signupCountry?: string | null,
): string[] {
  const g = (geo ?? {}) as ServiceGeo;

  const explicit = Array.isArray(g.countries)
    ? g.countries.filter((c): c is string => typeof c === "string" && ISO.test(c.toUpperCase()))
    : [];
  if (explicit.length > 0) return explicit.map((c) => c.toUpperCase());

  const signup = (signupCountry ?? "").toUpperCase();
  if (ISO.test(signup)) return [signup];

  const parsed = countriesFromText(g.raw ?? "");
  if (parsed.length > 0) return parsed;

  return ["NG"];
}

/** Build the stored geo object from what the owner typed at signup. */
export function buildServiceGeo(raw: string, signupCountry?: string | null): ServiceGeo {
  const text = (raw ?? "").trim();
  return {
    raw: text,
    countries: resolveTargetCountries({ raw: text }, signupCountry),
    cities: citiesFromText(text),
  };
}
