import { describe, expect, it } from "vitest";
import { isTierId, subscriptionConfigForTier } from "./subscription";

describe("isTierId", () => {
  it("accepts the three tiers, rejects anything else", () => {
    expect(isTierId("starter")).toBe(true);
    expect(isTierId("growth")).toBe(true);
    expect(isTierId("scale")).toBe(true);
    expect(isTierId("free")).toBe(false);
    expect(isTierId(null)).toBe(false);
  });
});

describe("subscriptionConfigForTier", () => {
  it("maps each tier to its markup + platforms (from the pricing model)", () => {
    expect(subscriptionConfigForTier("starter")).toMatchObject({
      spendMarkupBps: 1500,
      platforms: ["meta"],
    });
    expect(subscriptionConfigForTier("growth")).toMatchObject({
      spendMarkupBps: 1200,
      platforms: ["meta", "tiktok"],
    });
    expect(subscriptionConfigForTier("scale")).toMatchObject({
      spendMarkupBps: 1000,
      platforms: ["meta", "tiktok", "google"],
    });
  });
  it("higher tiers get more renders and a lower markup", () => {
    const s = subscriptionConfigForTier("starter");
    const g = subscriptionConfigForTier("growth");
    const sc = subscriptionConfigForTier("scale");
    expect(g.rendersPerDay).toBeGreaterThan(s.rendersPerDay);
    expect(sc.rendersPerDay).toBeGreaterThan(g.rendersPerDay);
    expect(g.spendMarkupBps).toBeLessThan(s.spendMarkupBps);
    expect(sc.spendMarkupBps).toBeLessThan(g.spendMarkupBps);
  });
});
