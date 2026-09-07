import { describe, expect, it } from "vitest";
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

describe("pspChargeCurrency", () => {
  it("charges the customer in their own currency where the rail supports it", () => {
    expect(pspChargeCurrency("NGN")).toBe("NGN");
    expect(pspChargeCurrency("GHS")).toBe("GHS");
    expect(pspChargeCurrency("KES")).toBe("KES");
    expect(pspChargeCurrency("ZAR")).toBe("ZAR");
  });

  it("falls back to USD for currencies these rails cannot settle", () => {
    // Showing rupees and charging naira would be worse than charging USD.
    expect(pspChargeCurrency("INR")).toBe("USD");
    expect(pspChargeCurrency("EUR")).toBe("USD");
    expect(pspChargeCurrency("GBP")).toBe("USD");
    expect(pspChargeCurrency("AED")).toBe("USD");
  });

  it("falls back to USD when the currency is missing or junk", () => {
    expect(pspChargeCurrency(null)).toBe("USD");
    expect(pspChargeCurrency(undefined)).toBe("USD");
    expect(pspChargeCurrency("")).toBe("USD");
    expect(pspChargeCurrency("nonsense")).toBe("USD");
  });

  it("tolerates casing and whitespace from stored data", () => {
    expect(pspChargeCurrency(" ngn ")).toBe("NGN");
    expect(pspChargeCurrency("ghs")).toBe("GHS");
  });

  it("never invents a currency the rails cannot charge", () => {
    for (const c of listCountries()) {
      expect(["NGN", "GHS", "KES", "ZAR", "USD"]).toContain(pspChargeCurrency(c.currency));
    }
  });
});

describe("chargesInLocalCurrency", () => {
  it("is true only when the customer pays in their own non-USD currency", () => {
    expect(chargesInLocalCurrency("NGN")).toBe(true);
    expect(chargesInLocalCurrency("GHS")).toBe(true);
    // A US customer's own currency IS USD, so nothing is being converted.
    expect(chargesInLocalCurrency("USD")).toBe(false);
    // An Indian customer is converted to USD, so this is not their currency.
    expect(chargesInLocalCurrency("INR")).toBe(false);
    expect(chargesInLocalCurrency(null)).toBe(false);
  });
});
