import { describe, expect, it } from "vitest";
import { economicsTotals, marginFor, rankByMargin, type CustomerCosts } from "./economics";

const base: CustomerCosts = {
  businessId: "b1",
  name: "Shop",
  tier: "starter",
  renderCostUsdMinor: 100,
  renderCount: 20,
  markupRevenueUsdMinor: 0,
  subscribed: true,
};
const row = (o: Partial<CustomerCosts>): CustomerCosts => ({ ...base, ...o });

describe("marginFor", () => {
  it("keeps subscription and markup apart rather than netting them", () => {
    // Netting hides the case that matters: a customer whose subscription does
    // not cover their renders but whose ad spend easily does.
    const m = marginFor(row({ markupRevenueUsdMinor: 500 }));
    expect(m.subscriptionUsdMinor).toBeGreaterThan(0);
    expect(m.markupUsdMinor).toBe(500);
    expect(m.revenueUsdMinor).toBe(m.subscriptionUsdMinor + 500);
  });

  it("flags a customer who costs more to serve than they pay", () => {
    const m = marginFor(row({ tier: "starter", renderCostUsdMinor: 1_000_000 }));
    expect(m.underwater).toBe(true);
    expect(m.marginUsdMinor).toBeLessThan(0);
  });

  it("counts no subscription revenue for an unsubscribed customer", () => {
    const m = marginFor(row({ subscribed: false }));
    expect(m.subscriptionUsdMinor).toBe(0);
    // A free account that renders is pure cost.
    expect(m.underwater).toBe(true);
  });

  it("reports no ratio rather than Infinity when revenue is zero", () => {
    // Dividing by zero here would put Infinity on a dashboard.
    const m = marginFor(row({ subscribed: false, markupRevenueUsdMinor: 0 }));
    expect(m.costRatio).toBeNull();
  });

  it("computes cost as a share of revenue when there is revenue", () => {
    const m = marginFor(row({ subscribed: false, markupRevenueUsdMinor: 400, renderCostUsdMinor: 100 }));
    expect(m.costRatio).toBeCloseTo(0.25);
  });

  it("is not underwater when cost exactly equals revenue", () => {
    const m = marginFor(row({ subscribed: false, markupRevenueUsdMinor: 100, renderCostUsdMinor: 100 }));
    expect(m.underwater).toBe(false);
    expect(m.marginUsdMinor).toBe(0);
  });

  it("handles a customer who has rendered nothing", () => {
    const m = marginFor(row({ renderCostUsdMinor: 0, renderCount: 0 }));
    expect(m.costUsdMinor).toBe(0);
    expect(m.underwater).toBe(false);
  });
});

describe("rankByMargin", () => {
  it("puts the worst margin first", () => {
    const ranked = rankByMargin([
      row({ businessId: "ok", markupRevenueUsdMinor: 5_000 }),
      row({ businessId: "bad", renderCostUsdMinor: 900_000 }),
      row({ businessId: "mid" }),
    ]);
    expect(ranked[0].businessId).toBe("bad");
    expect(ranked.at(-1)!.businessId).toBe("ok");
  });

  it("does not mutate its input", () => {
    const input = [row({ businessId: "a" }), row({ businessId: "b", renderCostUsdMinor: 9_000_000 })];
    rankByMargin(input);
    expect(input.map((r) => r.businessId)).toEqual(["a", "b"]);
  });
});

describe("economicsTotals", () => {
  it("sums revenue, cost and margin and counts the underwater ones", () => {
    const t = economicsTotals([
      row({ subscribed: false, markupRevenueUsdMinor: 1_000, renderCostUsdMinor: 200, renderCount: 5 }),
      row({ subscribed: false, markupRevenueUsdMinor: 0, renderCostUsdMinor: 300, renderCount: 7 }),
    ]);
    expect(t).toEqual({
      revenueUsdMinor: 1_000,
      costUsdMinor: 500,
      marginUsdMinor: 500,
      underwaterCount: 1,
      renderCount: 12,
    });
  });

  it("is all zeroes for no customers rather than NaN", () => {
    expect(economicsTotals([])).toEqual({
      revenueUsdMinor: 0, costUsdMinor: 0, marginUsdMinor: 0, underwaterCount: 0, renderCount: 0,
    });
  });
});

describe("a tier value that is not a real tier", () => {
  it("earns no subscription revenue instead of throwing", () => {
    // The column is a string. A dashboard that crashes on one odd row shows
    // nothing about the other twenty.
    const m = marginFor({ ...base, tier: "platinum", renderCostUsdMinor: 50 });
    expect(m.subscriptionUsdMinor).toBe(0);
    expect(m.underwater).toBe(true);
  });
});
