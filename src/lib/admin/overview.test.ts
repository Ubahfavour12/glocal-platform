import { describe, expect, it } from "vitest";
import { health, rankCustomers, totals, type CustomerRow } from "./overview";

const base: CustomerRow = {
  businessId: "b1",
  name: "Shop",
  ownerEmail: "a@b.com",
  plan: "scale",
  currency: "NGN",
  balanceUsdMinor: 10_000,
  dailyBudgetUsdMinor: 1_000,
  liveAds: 0,
  lastActivityAt: "2026-09-10T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
};
const row = (over: Partial<CustomerRow>): CustomerRow => ({ ...base, ...over });

describe("health", () => {
  it("calls a paid, funded, running account spending", () => {
    expect(health(row({ liveAds: 2 }))).toBe("spending");
  });

  it("calls a paid, funded, idle account ready — the one worth chasing", () => {
    expect(health(row({ liveAds: 0 }))).toBe("ready");
  });

  it("reports an empty wallet on a paid account", () => {
    expect(health(row({ balanceUsdMinor: 0 }))).toBe("empty_wallet");
  });

  it("blames the free plan before the empty wallet", () => {
    // Money alone would not let a free account launch, so "add funds" would be
    // the wrong thing to tell them.
    expect(health(row({ plan: "free", balanceUsdMinor: 0 }))).toBe("free");
  });

  it("calls a funded account with no budget set not-set-up", () => {
    expect(health(row({ dailyBudgetUsdMinor: 0 }))).toBe("onboarding");
  });
});

describe("rankCustomers", () => {
  it("puts funded-but-idle first and free accounts last", () => {
    const ranked = rankCustomers([
      row({ businessId: "free", plan: "free" }),
      row({ businessId: "spending", liveAds: 3 }),
      row({ businessId: "idle" }),
      row({ businessId: "broke", balanceUsdMinor: 0 }),
    ]);
    expect(ranked.map((r) => r.businessId)).toEqual(["idle", "broke", "spending", "free"]);
  });

  it("breaks ties by most recently active", () => {
    const ranked = rankCustomers([
      row({ businessId: "older", lastActivityAt: "2026-09-01T00:00:00Z" }),
      row({ businessId: "newer", lastActivityAt: "2026-09-12T00:00:00Z" }),
    ]);
    expect(ranked.map((r) => r.businessId)).toEqual(["newer", "older"]);
  });

  it("falls back to signup date when a customer has never done anything", () => {
    const ranked = rankCustomers([
      row({ businessId: "a", lastActivityAt: null, createdAt: "2026-01-01T00:00:00Z" }),
      row({ businessId: "b", lastActivityAt: null, createdAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(ranked.map((r) => r.businessId)).toEqual(["b", "a"]);
  });

  it("does not mutate the array it is given", () => {
    const input = [row({ businessId: "x", plan: "free" }), row({ businessId: "y" })];
    rankCustomers(input);
    expect(input.map((r) => r.businessId)).toEqual(["x", "y"]);
  });
});

describe("totals", () => {
  it("counts customers, payers and live accounts", () => {
    const t = totals([
      row({ plan: "free", balanceUsdMinor: 0 }),
      row({ plan: "starter", liveAds: 1, balanceUsdMinor: 5_000 }),
      row({ plan: "scale", balanceUsdMinor: 2_000 }),
    ]);
    expect(t).toEqual({ customers: 3, paying: 2, running: 1, walletUsdMinor: 7_000 });
  });

  it("never lets a negative balance reduce the float", () => {
    // A negative row would be a ledger bug; it must not quietly cancel out
    // another customer's real money and understate what is owed.
    expect(totals([row({ balanceUsdMinor: -5_000 }), row({ balanceUsdMinor: 1_000 })])
      .walletUsdMinor).toBe(1_000);
  });
});
