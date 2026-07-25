/**
 * Country -> local currency (Phase 3 multi-currency display).
 * USD is always the canonical currency (ledger, all math); the customer's
 * country picks the LOCAL currency we show alongside it (₦, KSh, ₵, ...), so
 * Glocal reads as multinational, not Naira-first. Pure + fixture-tested.
 */

export interface CountryCurrency {
  /** ISO 3166-1 alpha-2 */
  country: string;
  countryName: string;
  /** ISO 4217 */
  currency: string;
  symbol: string;
}

// First-market + common signup countries. Extend freely; unknown -> USD.
const COUNTRIES: CountryCurrency[] = [
  { country: "NG", countryName: "Nigeria", currency: "NGN", symbol: "₦" },
  { country: "GH", countryName: "Ghana", currency: "GHS", symbol: "₵" },
  { country: "KE", countryName: "Kenya", currency: "KES", symbol: "KSh" },
  { country: "ZA", countryName: "South Africa", currency: "ZAR", symbol: "R" },
  { country: "UG", countryName: "Uganda", currency: "UGX", symbol: "USh" },
  { country: "TZ", countryName: "Tanzania", currency: "TZS", symbol: "TSh" },
  { country: "EG", countryName: "Egypt", currency: "EGP", symbol: "E£" },
  { country: "US", countryName: "United States", currency: "USD", symbol: "$" },
  { country: "GB", countryName: "United Kingdom", currency: "GBP", symbol: "£" },
  { country: "CA", countryName: "Canada", currency: "CAD", symbol: "C$" },
  { country: "EU", countryName: "Eurozone", currency: "EUR", symbol: "€" },
  { country: "IN", countryName: "India", currency: "INR", symbol: "₹" },
  { country: "AE", countryName: "United Arab Emirates", currency: "AED", symbol: "د.إ" },
];

export const DEFAULT_COUNTRY: CountryCurrency = {
  country: "US",
  countryName: "United States",
  currency: "USD",
  symbol: "$",
};

/** Alphabetical country list for the onboarding selector. */
export function listCountries(): CountryCurrency[] {
  return [...COUNTRIES].sort((a, b) => a.countryName.localeCompare(b.countryName));
}

/** Resolve a country code to its currency; unknown falls back to USD. */
export function currencyForCountry(code: string | null | undefined): CountryCurrency {
  if (!code) return DEFAULT_COUNTRY;
  const c = COUNTRIES.find((x) => x.country === code.trim().toUpperCase());
  return c ?? DEFAULT_COUNTRY;
}
