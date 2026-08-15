import { describe, expect, it } from "vitest";
import {
  buildServiceGeo,
  citiesFromText,
  countriesFromText,
  resolveTargetCountries,
} from "./geo";

describe("countriesFromText", () => {
  it("recognises country names", () => {
    expect(countriesFromText("Ghana")).toEqual(["GH"]);
    expect(countriesFromText("we ship across Kenya")).toEqual(["KE"]);
  });

  it("resolves a bare city to its country", () => {
    expect(countriesFromText("Lagos")).toEqual(["NG"]);
    expect(countriesFromText("Accra and Kumasi")).toEqual(["GH"]);
  });

  it("does not mistake South Africa for something else", () => {
    // Longest-first matching matters: a naive scan could miss this.
    expect(countriesFromText("South Africa")).toEqual(["ZA"]);
  });

  it("handles several places at once", () => {
    const found = countriesFromText("Lagos, Accra and Nairobi");
    expect(found.sort()).toEqual(["GH", "KE", "NG"]);
  });

  it("returns nothing for text it cannot read", () => {
    expect(countriesFromText("everywhere")).toEqual([]);
    expect(countriesFromText("")).toEqual([]);
  });
});

describe("citiesFromText", () => {
  it("returns recognised places, title-cased", () => {
    expect(citiesFromText("lagos and abuja").sort()).toEqual(["Abuja", "Lagos"]);
  });
});

describe("resolveTargetCountries", () => {
  it("prefers explicit stored countries", () => {
    expect(resolveTargetCountries({ countries: ["GH"], raw: "Lagos" }, "NG")).toEqual(["GH"]);
  });

  it("trusts the signup country over typed prose", () => {
    // Picked from a list, so it cannot be a misspelling or an ambiguity.
    expect(resolveTargetCountries({ raw: "Lagos" }, "GH")).toEqual(["GH"]);
  });

  it("falls back to parsing the text when there is no signup country", () => {
    expect(resolveTargetCountries({ raw: "Accra" }, null)).toEqual(["GH"]);
  });

  it("defaults to Nigeria only when nothing else is known", () => {
    expect(resolveTargetCountries({}, null)).toEqual(["NG"]);
    expect(resolveTargetCountries(null, "")).toEqual(["NG"]);
  });

  it("ignores malformed country codes rather than passing them to Meta", () => {
    expect(resolveTargetCountries({ countries: ["NIGERIA", "x"] }, "GH")).toEqual(["GH"]);
  });

  it("normalises case", () => {
    expect(resolveTargetCountries({ countries: ["gh"] }, null)).toEqual(["GH"]);
  });
});

describe("buildServiceGeo", () => {
  it("keeps what was typed and adds the resolved targeting", () => {
    const geo = buildServiceGeo("Lagos and Abuja", "NG");
    expect(geo.raw).toBe("Lagos and Abuja");
    expect(geo.countries).toEqual(["NG"]);
    expect(geo.cities?.sort()).toEqual(["Abuja", "Lagos"]);
  });

  it("does not target Nigeria for a Ghanaian business", () => {
    // The bug this module exists to fix: free text was never read, so every
    // account was targeted at Nigeria regardless of where it sells.
    const geo = buildServiceGeo("Accra", "GH");
    expect(geo.countries).toEqual(["GH"]);
  });
});
