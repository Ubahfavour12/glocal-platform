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

/**
 * Currencies THIS MERCHANT can actually charge in.
 *
 * The distinction matters and getting it wrong took checkout down. Paystack as
 * a product supports NGN, GHS, KES, ZAR and USD — but no single merchant
 * supports all of them. A Nigerian Paystack account can charge NGN, and USD
 * only once international payments are approved; GHS and KES require an
 * account registered in Ghana or Kenya. Listing the product's currencies here
 * meant a GBP customer fell back to USD, and Paystack answered "Currency not
 * supported by merchant" — a real, live checkout failure.
 *
 * So this is configuration, not a constant: it describes one account's
 * approvals, which change without any code changing. Default NGN alone,
 * because that is what a fresh Nigerian account can do on day one. Add USD to
 * the env var the day international payments are approved, and foreign
 * customers are quoted dollars from that deploy on.
 */
export function merchantCurrencies(): string[] {
  const raw = process.env.PSP_MERCHANT_CURRENCIES?.trim();
  if (!raw) return ["NGN"];
  const parsed = raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  // An empty or all-whitespace value is a misconfiguration, not an instruction
  // to charge in nothing. Falling back keeps checkout alive.
  return parsed.length > 0 ? parsed : ["NGN"];
}

/**
 * What to actually charge a customer in, given their signup currency.
 *
 * Their own currency when the merchant is approved for it. Otherwise USD if
 * available, because a foreign customer reading dollars understands the price;
 * otherwise the merchant's home currency, which at least completes.
 *
 * USD stays the canonical ledger amount regardless. This only decides what the
 * customer is asked to pay in, with the conversion happening behind it at the
 * buffered rate.
 */
export function pspChargeCurrency(businessCurrency: string | null | undefined): string {
  const supported = merchantCurrencies();
  const c = businessCurrency?.trim().toUpperCase();
  if (c && supported.includes(c)) return c;
  return supported.includes("USD") ? "USD" : supported[0];
}

/** Is this customer charged in their own currency, or converted to something else? */
export function chargesInLocalCurrency(businessCurrency: string | null | undefined): boolean {
  const c = businessCurrency?.trim().toUpperCase();
  return Boolean(c && merchantCurrencies().includes(c));
}
