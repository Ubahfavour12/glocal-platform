import { describe, expect, it } from "vitest";
import { audienceConstraintsFor } from "./targeting";

describe("audienceConstraintsFor", () => {
  it("leaves ordinary categories completely alone", () => {
    // Creative-Led Broad Targeting: we only ever add what a network REQUIRES.
    const c = audienceConstraintsFor("fashion boutique", ["NG"]);
    expect(c.ageMin).toBeUndefined();
    expect(c.countries).toEqual(["NG"]);
    expect(c.note).toBeNull();
  });

  it("age-gates alcohol at 18 in our first markets", () => {
    const c = audienceConstraintsFor("wine retail", ["NG", "GH"]);
    expect(c.ageMin).toBe(18);
    expect(c.note).toMatch(/18\+/);
  });

  it("uses the strictest age across the targeted markets", () => {
    // One ad set serves every country in it, so the floor must satisfy the
    // toughest market, not the average one.
    expect(audienceConstraintsFor("wine", ["NG", "US"]).ageMin).toBe(21);
    expect(audienceConstraintsFor("spirits", ["GB", "CA"]).ageMin).toBe(19);
  });

  it("drops markets where alcohol cannot be advertised at all", () => {
    const c = audienceConstraintsFor("wine", ["NG", "AE", "SA"]);
    expect(c.countries).toEqual(["NG"]);
    expect(c.blockedCountries.sort()).toEqual(["AE", "SA"]);
    expect(c.note).toMatch(/cannot be advertised/);
  });

  it("catches the words people actually use", () => {
    for (const cat of ["Champagne seller", "craft beer", "premium whiskey", "vodka brand"]) {
      expect(audienceConstraintsFor(cat, ["NG"]).ageMin).toBe(18);
    }
  });

  it("age-gates other adult-only categories without geo-blocking them", () => {
    const c = audienceConstraintsFor("dating app", ["NG"]);
    expect(c.ageMin).toBe(18);
    expect(c.blockedCountries).toEqual([]);
  });

  it("does not match innocent words containing a restricted term", () => {
    // "Wineberry" or "Beeretta" must not trigger an alcohol gate.
    expect(audienceConstraintsFor("wineberry cosmetics", ["NG"]).ageMin).toBeUndefined();
  });
});
