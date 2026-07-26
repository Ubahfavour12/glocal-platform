import { describe, expect, it } from "vitest";
import { currencyForCountry, dialCodeForCountry, DEFAULT_COUNTRY, listCountries } from "./currency";

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
