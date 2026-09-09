import { afterEach, describe, expect, it, vi } from "vitest";
import { currencyForCountry, dialCodeForCountry, DEFAULT_COUNTRY, listCountries, pspChargeCurrency, chargesInLocalCurrency } from "./currency";

describe("currencyForCountry", () => {
  it("maps known countries to their local currency + symbol", () => {
    expect(currencyForCountry("NG")).toMatchObject({ currency: "NGN", symbol: "₦" });
    expect(currencyForCountry("gb")).toMatchObject({ currency: "GBP", symbol: "£" });
    expect(currencyForCountry("KE")).toMatchObject({ currency: "KES" });
  });

  it("falls back to USD for unknown or empty", () => {
    expect(currencyForCountry("ZZ")).toEqual(DEFAULT_COUNTRY);
    expect(currencyForCountry(null)).toEqual(DEFAULT_COUNTRY);
    expect(currencyForCountry("")).toEqual(DEFAULT_COUNTRY);
  });
});

describe("dialCodeForCountry", () => {
  it("returns the country's dialling code", () => {
    expect(dialCodeForCountry("NG")).toBe("+234");
    expect(dialCodeForCountry("gb")).toBe("+44");
    expect(dialCodeForCountry("US")).toBe("+1");
  });
  it("falls back to the default country's code for unknown/empty", () => {
    expect(dialCodeForCountry("ZZ")).toBe(DEFAULT_COUNTRY.dialCode);
    expect(dialCodeForCountry(null)).toBe(DEFAULT_COUNTRY.dialCode);
  });
});

describe("listCountries", () => {
  it("returns an alphabetical, non-empty list", () => {
    const list = listCountries();
    expect(list.length).toBeGreaterThan(5);
    const names = list.map((c) => c.countryName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(list.some((c) => c.country === "NG")).toBe(true);
  });
});

describe("pspChargeCurrency — what THIS merchant may charge", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to NGN alone, which is what a fresh Nigerian account can do", () => {
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", "");
    expect(pspChargeCurrency("NGN")).toBe("NGN");
  });

  it("does NOT charge a GBP customer in USD when USD is not approved", () => {
    // The live failure: Paystack answered "Currency not supported by merchant"
    // and no customer could top up at all. USD is a product currency, not
    // necessarily a merchant one.
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", "");
    expect(pspChargeCurrency("GBP")).toBe("NGN");
    expect(pspChargeCurrency("EGP")).toBe("NGN");
    expect(pspChargeCurrency("USD")).toBe("NGN");
  });

  it("does NOT offer GHS or KES on a Nigerian account", () => {
    // Paystack supports them; a Nigerian merchant does not.
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", "");
    expect(pspChargeCurrency("GHS")).toBe("NGN");
    expect(pspChargeCurrency("KES")).toBe("NGN");
  });

  it("quotes dollars once international payments are approved", () => {
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", "NGN,USD");
    expect(pspChargeCurrency("GBP")).toBe("USD");
    expect(pspChargeCurrency("USD")).toBe("USD");
    // A Nigerian customer still pays naira, not dollars.
    expect(pspChargeCurrency("NGN")).toBe("NGN");
  });

  it("tolerates spacing and casing in the env var", () => {
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", " ngn , usd ");
    expect(pspChargeCurrency("GBP")).toBe("USD");
  });

  it("falls back rather than charging in nothing on a junk value", () => {
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", " , , ");
    expect(pspChargeCurrency("GBP")).toBe("NGN");
  });

  it("handles a missing business currency", () => {
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", "");
    expect(pspChargeCurrency(null)).toBe("NGN");
    expect(pspChargeCurrency(undefined)).toBe("NGN");
  });
});

describe("chargesInLocalCurrency", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is true only when the merchant can charge that currency", () => {
    vi.stubEnv("PSP_MERCHANT_CURRENCIES", "NGN");
    expect(chargesInLocalCurrency("NGN")).toBe(true);
    expect(chargesInLocalCurrency("GBP")).toBe(false);
    expect(chargesInLocalCurrency("GHS")).toBe(false);
  });
});

