import { describe, expect, it } from "vitest";
import {
  effectiveRate,
  isStale,
  localCostForUsd,
  StaleRateError,
  usdCreditForLocal,
  type RateSnapshot,
} from "./fx";

const now = new Date("2026-07-10T12:00:00Z");
const fresh: RateSnapshot = {
  quote: "NGN",
  rate: 1500, // ₦1,500 per USD market rate
  fetchedAt: new Date("2026-07-10T11:30:00Z"),
};

describe("effectiveRate", () => {
  it("adds the 3% protective buffer", () => {
    expect(effectiveRate(fresh)).toBeCloseTo(1545, 6);
  });

  it("rejects non-positive rates", () => {
    expect(() => effectiveRate({ ...fresh, rate: 0 })).toThrow();
    expect(() => effectiveRate({ ...fresh, rate: -10 })).toThrow();
  });
});

describe("staleness", () => {
  it("accepts rates within the 90-minute window", () => {
    expect(isStale(fresh, now)).toBe(false);
  });

  it("flags rates older than 90 minutes", () => {
    const old = { ...fresh, fetchedAt: new Date("2026-07-10T10:00:00Z") };
    expect(isStale(old, now)).toBe(true);
    expect(() => localCostForUsd(1000, old, now)).toThrow(StaleRateError);
    expect(() => usdCreditForLocal(1_545_000, old, now)).toThrow(StaleRateError);
  });
});

describe("localCostForUsd", () => {
  it("charges the buffered rate, rounding up", () => {
    // $10.00 = 1000¢ × 1545 = 1,545,000 kobo exactly
    expect(localCostForUsd(1000, fresh, now)).toBe(1_545_000);
    // $0.01 = 1¢ × 1545 = 1545 kobo
    expect(localCostForUsd(1, fresh, now)).toBe(1545);
  });

  it("never undercollects on fractional results", () => {
    const odd: RateSnapshot = { ...fresh, rate: 1500.373 };
    const cost = localCostForUsd(999, odd, now);
    expect(cost).toBeGreaterThanOrEqual(999 * 1500.373 * 1.03);
    expect(Number.isInteger(cost)).toBe(true);
  });

  it("rejects non-integer and negative amounts", () => {
    expect(() => localCostForUsd(10.5, fresh, now)).toThrow();
    expect(() => localCostForUsd(-100, fresh, now)).toThrow();
  });
});

describe("usdCreditForLocal", () => {
  it("credits at the buffered rate, rounding down", () => {
    expect(usdCreditForLocal(1_545_000, fresh, now)).toBe(1000);
  });

  it("round-trip never credits more than was paid for", () => {
    for (const usd of [1, 999, 12_345, 700_000]) {
      const local = localCostForUsd(usd, fresh, now);
      expect(usdCreditForLocal(local, fresh, now)).toBeGreaterThanOrEqual(usd);
      // and never more than a cent of drift
      expect(usdCreditForLocal(local, fresh, now)).toBeLessThanOrEqual(usd + 1);
    }
  });
});
