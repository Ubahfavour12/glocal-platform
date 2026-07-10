import { describe, expect, it } from "vitest";
import {
  aggregateWindow,
  decideVerdict,
  isEligible,
  type CandidateMetrics,
  type DailyMetrics,
} from "./verdict";

const now = new Date("2026-07-10T18:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const day = (n: number, m: Partial<DailyMetrics>): DailyMetrics => ({
  date: daysAgo(n),
  impressions: 0,
  clicks: 0,
  intents: 0,
  spendUsdMinor: 0,
  revenueUsdMinor: 0,
  ...m,
});

const candidate = (
  adId: string,
  startedHoursAgo: number,
  daily: DailyMetrics[],
): CandidateMetrics => ({
  adId,
  startedAt: new Date(now.getTime() - startedHoursAgo * 3_600_000),
  daily,
});

describe("aggregateWindow — rolling 3 days", () => {
  it("includes only the last 3 days", () => {
    const daily = [
      day(0, { impressions: 100 }),
      day(1, { impressions: 200 }),
      day(2, { impressions: 300 }),
      day(5, { impressions: 9_999 }), // outside window — a past fluke day
    ];
    expect(aggregateWindow(daily, now).impressions).toBe(600);
  });
});

describe("isEligible — 24h AND 5,000 impressions", () => {
  it("rejects candidates younger than 24 hours regardless of volume", () => {
    const c = candidate("a", 6, [day(0, { impressions: 50_000 })]);
    expect(isEligible(c, now)).toBe(false);
  });

  it("rejects candidates below 5,000 impressions regardless of age", () => {
    const c = candidate("a", 72, [day(0, { impressions: 4_999 })]);
    expect(isEligible(c, now)).toBe(false);
  });

  it("accepts candidates clearing both thresholds", () => {
    const c = candidate("a", 25, [day(0, { impressions: 5_000 })]);
    expect(isEligible(c, now)).toBe(true);
  });
});

describe("decideVerdict", () => {
  const eligibleA = candidate("a", 48, [
    day(0, { impressions: 6_000, clicks: 300, intents: 60, spendUsdMinor: 500, revenueUsdMinor: 2_000 }),
  ]);
  const eligibleB = candidate("b", 48, [
    day(0, { impressions: 6_000, clicks: 150, intents: 20, spendUsdMinor: 500, revenueUsdMinor: 800 }),
  ]);

  it("stays pending until every candidate is eligible — no verdicts on thin data", () => {
    const young = candidate("c", 4, [day(0, { impressions: 100 })]);
    const v = decideVerdict([eligibleA, young], { storeConnected: false, now });
    expect(v.status).toBe("pending");
  });

  it("uses ROAS when a store is connected", () => {
    const v = decideVerdict([eligibleA, eligibleB], { storeConnected: true, now });
    expect(v).toMatchObject({ status: "decided", winnerAdId: "a", metricUsed: "roas" });
  });

  it("uses CPCI (lower wins) without a store", () => {
    const v = decideVerdict([eligibleA, eligibleB], { storeConnected: false, now });
    // a: 500/60 ≈ 8.3¢ per intent; b: 500/20 = 25¢ per intent → a wins
    expect(v).toMatchObject({ status: "decided", winnerAdId: "a", metricUsed: "cpci" });
  });

  it("falls back to engagement when intents are missing", () => {
    const noIntentsA = candidate("a", 48, [
      day(0, { impressions: 6_000, clicks: 300, spendUsdMinor: 500 }),
    ]);
    const noIntentsB = candidate("b", 48, [
      day(0, { impressions: 6_000, clicks: 150, spendUsdMinor: 500 }),
    ]);
    const v = decideVerdict([noIntentsA, noIntentsB], { storeConnected: false, now });
    expect(v).toMatchObject({ status: "decided", winnerAdId: "a", metricUsed: "engagement" });
  });

  it("refuses to decide a dead tie", () => {
    const twinA = candidate("a", 48, [day(0, { impressions: 6_000, clicks: 100, spendUsdMinor: 500 })]);
    const twinB = candidate("b", 48, [day(0, { impressions: 6_000, clicks: 100, spendUsdMinor: 500 })]);
    const v = decideVerdict([twinA, twinB], { storeConnected: false, now });
    expect(v.status).toBe("pending");
  });

  it("requires at least two candidates", () => {
    const v = decideVerdict([eligibleA], { storeConnected: false, now });
    expect(v.status).toBe("pending");
  });
});
