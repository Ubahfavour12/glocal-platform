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
  /** International dialling code, e.g. "+234" (used for phone-field hints). */
  dialCode: string;
}

// First-market + common signup countries. Extend freely; unknown -> USD.
const COUNTRIES: CountryCurrency[] = [
  { country: "NG", countryName: "Nigeria", currency: "NGN", symbol: "₦", dialCode: "+234" },
  { country: "GH", countryName: "Ghana", currency: "GHS", symbol: "₵", dialCode: "+233" },
  { country: "KE", countryName: "Kenya", currency: "KES", symbol: "KSh", dialCode: "+254" },
  { country: "ZA", countryName: "South Africa", currency: "ZAR", symbol: "R", dialCode: "+27" },
  { country: "UG", countryName: "Uganda", currency: "UGX", symbol: "USh", dialCode: "+256" },
  { country: "TZ", countryName: "Tanzania", currency: "TZS", symbol: "TSh", dialCode: "+255" },
  { country: "EG", countryName: "Egypt", currency: "EGP", symbol: "E£", dialCode: "+20" },
  { country: "US", countryName: "United States", currency: "USD", symbol: "$", dialCode: "+1" },
  { country: "GB", countryName: "United Kingdom", currency: "GBP", symbol: "£", dialCode: "+44" },
  { country: "CA", countryName: "Canada", currency: "CAD", symbol: "C$", dialCode: "+1" },
  { country: "EU", countryName: "Eurozone", currency: "EUR", symbol: "€", dialCode: "+" },
  { country: "IN", countryName: "India", currency: "INR", symbol: "₹", dialCode: "+91" },
  { country: "AE", countryName: "United Arab Emirates", currency: "AED", symbol: "د.إ", dialCode: "+971" },
];

export const DEFAULT_COUNTRY: CountryCurrency = {
  country: "US",
  countryName: "United States",
  currency: "USD",
  symbol: "$",
  dialCode: "+1",
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

/** International dialling code for a country, e.g. "+234"; unknown -> "+". */
export function dialCodeForCountry(code: string | null | undefined): string {
  return currencyForCountry(code).dialCode;
}
