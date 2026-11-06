import { describe, expect, it } from "vitest";
import {
  aggregateWindow,
  decideVerdict,
  isEligible,
  type CandidateMetrics,
  type DailyMetrics,
  MIN_DECIDED_LEADS,
  attentionScore,
  frequencyOf,
  saturatedAds,
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

describe("MIN_DECIDED_LEADS — refusing to decide on noise", () => {
  const day = (spend: number): DailyMetrics => ({
    date: new Date("2026-03-10T00:00:00Z"),
    impressions: 10_000,
    clicks: 100,
    intents: 10,
    spendUsdMinor: spend,
    revenueUsdMinor: 0,
  });
  const now = new Date("2026-03-11T00:00:00Z");
  const cand = (adId: string, decided: number, won: number) => ({
    adId,
    startedAt: new Date("2026-03-08T00:00:00Z"),
    daily: [day(10_000)],
    leadOutcome: { decided, won, revenueUsdMinor: won * 50_000 },
  });

  it("does NOT decide on one win out of two leads", () => {
    // The case that prompted the guard: a 50% win rate on a sample where one
    // customer changing their mind flips the answer, and the agent would move
    // real budget on it.
    const v = decideVerdict([cand("a", 2, 1), cand("b", 2, 0)], {
      storeConnected: false,
      now,
    });
    if (v.status === "decided") expect(v.metricUsed).not.toBe("cost_per_won");
  });

  it("decides once both ads clear the threshold", () => {
    const v = decideVerdict(
      [cand("a", MIN_DECIDED_LEADS, 4), cand("b", MIN_DECIDED_LEADS, 1)],
      { storeConnected: false, now },
    );
    expect(v.status).toBe("decided");
    if (v.status === "decided") {
      expect(v.metricUsed).toBe("cost_per_won");
      expect(v.winnerAdId).toBe("a");
    }
  });

  it("holds back when only ONE ad has enough settled leads", () => {
    // Otherwise the ad whose leads happened to be reviewed first wins by
    // being reviewed first.
    const v = decideVerdict([cand("a", 20, 9), cand("b", 2, 1)], {
      storeConnected: false,
      now,
    });
    if (v.status === "decided") expect(v.metricUsed).not.toBe("cost_per_won");
  });

  it("still falls through to a weaker metric rather than stalling", () => {
    // Below the bar the engine must not simply refuse to pick anything — a
    // duel with no verdict never rotates the budget at all. The two ads are
    // given DIFFERENT spend here on purpose: with identical spend and intents
    // every metric ties, and refusing to separate two identical ads is correct
    // behaviour rather than the fallback being tested.
    const thin = (adId: string, spend: number) => ({
      adId,
      startedAt: new Date("2026-03-08T00:00:00Z"),
      daily: [day(spend)],
      leadOutcome: { decided: 1, won: 1, revenueUsdMinor: 50_000 },
    });
    const v = decideVerdict([thin("a", 8_000), thin("b", 20_000)], {
      storeConnected: false,
      now,
    });
    expect(v.status).toBe("decided");
    if (v.status === "decided") {
      expect(v.metricUsed).toBe("cpci");
      expect(v.winnerAdId).toBe("a");
    }
  });
});

describe("awareness verdicts", () => {
  const day = (over: Partial<DailyMetrics> = {}): DailyMetrics => ({
    date: new Date("2026-07-20T00:00:00Z"),
    impressions: 6_000,
    clicks: 100,
    intents: 0,
    spendUsdMinor: 1_000,
    revenueUsdMinor: 0,
    reach: 3_000,
    attention: { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 },
    ...over,
  });
  const when = new Date("2026-07-21T12:00:00Z");
  const started = new Date("2026-07-19T00:00:00Z");
  const ad = (adId: string, over: Partial<DailyMetrics>): CandidateMetrics => ({
    adId,
    startedAt: started,
    daily: [day(over)],
  });

  it("picks the ad people actually kept, not the one they clicked", () => {
    // THE BUG THIS FIXES. "bait" wins every click comparison; "real" is saved
    // and shared. Before the attention branch the clickbait ad won the duel
    // and took the budget.
    const bait = ad("bait", {
      clicks: 900,
      attention: { saves: 0, shares: 0, comments: 1, reactions: 2, thruPlays: 0 },
    });
    const real = ad("real", {
      clicks: 20,
      attention: { saves: 40, shares: 25, comments: 10, reactions: 60, thruPlays: 200 },
    });
    const v = decideVerdict([bait, real], { storeConnected: false, awareness: true, now: when });
    expect(v.status).toBe("decided");
    if (v.status === "decided") {
      expect(v.winnerAdId).toBe("real");
      expect(v.metricUsed).toBe("attention");
    }
  });

  it("refuses to judge on clicks when attention data is missing", () => {
    // Falling through to CTR would reintroduce the exact bug above, so an
    // awareness duel stops instead of answering the wrong question.
    const a = ad("a", { clicks: 900 });
    const b = ad("b", { clicks: 20 });
    const v = decideVerdict([a, b], { storeConnected: false, awareness: true, now: when });
    expect(v.status).toBe("pending");
    if (v.status === "pending") expect(v.reason).toMatch(/clicks are not what this ad is buying/);
  });

  it("never reports engagement for an awareness goal", () => {
    for (const attention of [
      undefined,
      { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 },
    ]) {
      const v = decideVerdict(
        [ad("a", { clicks: 900, attention }), ad("b", { clicks: 10, attention })],
        { storeConnected: false, awareness: true, now: when },
      );
      expect(v.status === "decided" && v.metricUsed === "engagement").toBe(false);
    }
  });

  it("stays a cost metric, so cheap-and-ignored cannot win on volume", () => {
    // Same attention score, one ad spent four times as much to get it.
    const counts = { saves: 10, shares: 10, comments: 0, reactions: 0, thruPlays: 0 };
    const cheap = ad("cheap", { spendUsdMinor: 1_000, attention: counts });
    const dear = ad("dear", { spendUsdMinor: 4_000, attention: counts });
    const v = decideVerdict([cheap, dear], { storeConnected: false, awareness: true, now: when });
    expect(v.status === "decided" && v.winnerAdId).toBe("cheap");
  });

  it("leaves non-awareness duels exactly as they were", () => {
    const a = ad("a", { clicks: 900, intents: 30 });
    const b = ad("b", { clicks: 20, intents: 10 });
    const v = decideVerdict([a, b], { storeConnected: false, now: when });
    expect(v.status === "decided" && v.metricUsed).toBe("cpci");
  });

  it("still lets revenue outrank attention when a store is connected", () => {
    const a = ad("a", { revenueUsdMinor: 10_000, attention: { saves: 99, shares: 99, comments: 0, reactions: 0, thruPlays: 0 } });
    const b = ad("b", { revenueUsdMinor: 50_000, attention: { saves: 1, shares: 1, comments: 0, reactions: 0, thruPlays: 0 } });
    const v = decideVerdict([a, b], { storeConnected: true, awareness: true, now: when });
    expect(v.status === "decided" && v.metricUsed).toBe("roas");
    expect(v.status === "decided" && v.winnerAdId).toBe("b");
  });
});

describe("attentionScore", () => {
  const z = { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 };

  it("is zero for nothing and for absent data", () => {
    expect(attentionScore(undefined)).toBe(0);
    expect(attentionScore(z)).toBe(0);
  });

  it("ranks a share above a save above a reaction", () => {
    // The ordering is the defensible part of the weights: a share puts the
    // viewer's own name behind the ad, a reaction costs one tap.
    expect(attentionScore({ ...z, shares: 1 })).toBeGreaterThan(attentionScore({ ...z, saves: 1 }));
    expect(attentionScore({ ...z, saves: 1 })).toBeGreaterThan(
      attentionScore({ ...z, reactions: 1 }),
    );
  });

  it("cannot be out-farmed by cheap reactions alone", () => {
    // Four reactions must not beat one share plus one save.
    expect(attentionScore({ ...z, reactions: 4 })).toBeLessThan(
      attentionScore({ ...z, shares: 1, saves: 1 }),
    );
  });
});

describe("frequency guard", () => {
  it("computes impressions per person and flags saturation", () => {
    expect(frequencyOf({ impressions: 9_000, reach: 3_000 })).toBe(3);
    expect(frequencyOf({ impressions: 100, reach: 0 })).toBeNull();
    const aggs = new Map([
      ["fresh", { impressions: 3_000, reach: 3_000 } as never],
      ["saturated", { impressions: 12_000, reach: 3_000 } as never],
    ]);
    expect(saturatedAds(aggs)).toEqual(["saturated"]);
  });

  it("says nothing when reach is unknown rather than guessing", () => {
    expect(saturatedAds(new Map([["a", { impressions: 9_000, reach: 0 } as never]]))).toEqual([]);
  });
});
