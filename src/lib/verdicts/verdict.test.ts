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

describe("cost per WON lead — budget follows closed business", () => {
  const day = (over: Partial<DailyMetrics> = {}): DailyMetrics => ({
    date: new Date("2026-03-10T00:00:00Z"),
    impressions: 10_000,
    clicks: 100,
    intents: 10,
    spendUsdMinor: 10_000,
    revenueUsdMinor: 0,
    ...over,
  });
  const now = new Date("2026-03-11T00:00:00Z");
  const started = new Date("2026-03-08T00:00:00Z");

  const cand = (adId: string, spend: number, outcome?: {decided: number; won: number; revenueUsdMinor: number}) => ({
    adId,
    startedAt: started,
    daily: [day({ spendUsdMinor: spend })],
    leadOutcome: outcome,
  });

  it("prefers the ad that closed business over the one with cheap enquiries", () => {
    // The whole point. "cheap" produces enquiries at a third of the cost and
    // closes almost none of them; "good" is dearer per enquiry and actually
    // sells. CPCI would pick the wrong one and look rigorous doing it.
    const v = decideVerdict(
      [
        cand("cheap", 30_000, { decided: 10, won: 1, revenueUsdMinor: 5_000 }),
        cand("good", 30_000, { decided: 10, won: 6, revenueUsdMinor: 200_000 }),
      ],
      { storeConnected: false, now },
    );
    expect(v.status).toBe("decided");
    if (v.status === "decided") {
      expect(v.metricUsed).toBe("cost_per_won");
      expect(v.winnerAdId).toBe("good");
    }
  });

  it("falls back to CPCI until every ad has settled leads", () => {
    // Otherwise a slow follow-up week hands the duel to whichever ad the owner
    // happened to review first.
    const v = decideVerdict(
      [
        cand("a", 10_000, { decided: 4, won: 2, revenueUsdMinor: 90_000 }),
        cand("b", 10_000),
      ],
      { storeConnected: false, now },
    );
    if (v.status === "decided") expect(v.metricUsed).not.toBe("cost_per_won");
  });

  it("falls back when leads are settled but nothing anywhere has closed", () => {
    // With no wins the comparison is only between different ways of failing.
    const v = decideVerdict(
      [
        cand("a", 10_000, { decided: 5, won: 0, revenueUsdMinor: 0 }),
        cand("b", 10_000, { decided: 5, won: 0, revenueUsdMinor: 0 }),
      ],
      { storeConnected: false, now },
    );
    if (v.status === "decided") expect(v.metricUsed).not.toBe("cost_per_won");
  });

  it("beats one ad that closed nothing against one that did", () => {
    // Closing nothing IS the discriminating fact here, not missing data.
    const v = decideVerdict(
      [
        cand("dud", 20_000, { decided: 8, won: 0, revenueUsdMinor: 0 }),
        cand("real", 20_000, { decided: 8, won: 2, revenueUsdMinor: 80_000 }),
      ],
      { storeConnected: false, now },
    );
    expect(v.status).toBe("decided");
    if (v.status === "decided") {
      expect(v.metricUsed).toBe("cost_per_won");
      expect(v.winnerAdId).toBe("real");
    }
  });

  it("still lets trusted revenue (ROAS) outrank it", () => {
    // A connected store measures money directly; cost-per-won is a proxy built
    // from a human tapping buttons.
    const v = decideVerdict(
      [
        { ...cand("a", 10_000, { decided: 5, won: 5, revenueUsdMinor: 1_000 }), daily: [day({ spendUsdMinor: 10_000, revenueUsdMinor: 90_000 })] },
        { ...cand("b", 10_000, { decided: 5, won: 1, revenueUsdMinor: 1_000 }), daily: [day({ spendUsdMinor: 10_000, revenueUsdMinor: 10_000 })] },
      ],
      { storeConnected: true, now },
    );
    if (v.status === "decided") expect(v.metricUsed).toBe("roas");
  });
});
