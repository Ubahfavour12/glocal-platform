import { describe, expect, it } from "vitest";
import { buildLiveAdapters, overlayRevenue, type LiveDeps } from "./live-adapters";
import type { AdDayMetrics } from "@/lib/meta/insights";

const now = new Date("2026-07-21T20:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const insight = (adId: string, date: Date, over: Partial<AdDayMetrics> = {}): AdDayMetrics => ({
  adId,
  date: new Date(isoDay(date) + "T00:00:00Z"),
  impressions: 6_000,
  clicks: 180,
  spendUsdMinor: 500,
  ctr: 0.03,
  frequency: 1.5,
  intents: 20,
  revenueUsdMinor: 0,
  ...over,
});

function fakeDeps(over: Partial<LiveDeps> = {}): LiveDeps {
  return {
    fetchInsights: async () => [
      insight("m1", daysAgo(1)),
      insight("m1", daysAgo(2)),
      insight("m2", daysAgo(1)),
      insight("other", daysAgo(1)), // not part of the test — must be filtered
    ],
    listOpenTestAds: async () => [
      { adId: "uuid-1", platformAdId: "m1", startedAt: daysAgo(3) },
      { adId: "uuid-2", platformAdId: "m2", startedAt: daysAgo(3) },
    ],
    listAttributedRevenue: async () => [
      { platformAdId: "m1", dateIso: isoDay(daysAgo(1)), revenueUsdMinor: 12_000 },
    ],
    listAttributedOrderTimes: async () => [daysAgo(1), daysAgo(1.5), daysAgo(2)],
    getChampion: async () => ({ platformAdId: "m1", since: daysAgo(5) }),
    ...over,
  };
}

describe("overlayRevenue", () => {
  it("adds our verified revenue onto the platform's day rows", () => {
    const merged = overlayRevenue(
      [insight("m1", daysAgo(1))],
      [{ platformAdId: "m1", dateIso: isoDay(daysAgo(1)), revenueUsdMinor: 9_000 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].revenueUsdMinor).toBe(9_000);
    expect(merged[0].impressions).toBe(6_000); // platform data preserved
  });

  it("a sale on a silent day still counts (synthesised row)", () => {
    const merged = overlayRevenue(
      [],
      [{ platformAdId: "m1", dateIso: isoDay(daysAgo(1)), revenueUsdMinor: 5_000 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].revenueUsdMinor).toBe(5_000);
    expect(merged[0].impressions).toBe(0);
  });
});

describe("buildLiveAdapters", () => {
  it("builds candidates keyed by OUR ad ids, revenue overlaid, strangers filtered", async () => {
    const { getOpenTestCandidates } = buildLiveAdapters(fakeDeps(), now);
    const cands = await getOpenTestCandidates("biz");
    expect(cands.map((c) => c.adId).sort()).toEqual(["uuid-1", "uuid-2"]);
    const c1 = cands.find((c) => c.adId === "uuid-1")!;
    expect(c1.daily.reduce((s, d) => s + d.revenueUsdMinor, 0)).toBe(12_000);
    expect(cands.some((c) => c.adId === "other")).toBe(false);
  });

  it("returns [] when fewer than two open ads (no duel)", async () => {
    const { getOpenTestCandidates } = buildLiveAdapters(
      fakeDeps({ listOpenTestAds: async () => [] }),
      now,
    );
    expect(await getOpenTestCandidates("biz")).toEqual([]);
  });

  it("champion state: peak CTR ratchets over the reign, latest is current", async () => {
    const deps = fakeDeps({
      fetchInsights: async () => [
        insight("m1", daysAgo(4), { ctr: 0.05 }), // the peak
        insight("m1", daysAgo(2), { ctr: 0.04 }),
        insight("m1", daysAgo(1), { ctr: 0.02, frequency: 2.8 }), // current
      ],
    });
    const { getChampionState } = buildLiveAdapters(deps, now);
    const state = await getChampionState("biz");
    expect(state).not.toBeNull();
    expect(state!.peakCtr).toBe(0.05);
    expect(state!.currentCtr).toBe(0.02);
    expect(state!.frequency).toBe(2.8);
    expect(state!.championSince).toEqual(daysAgo(5));
  });

  it("no champion -> null state; no insights -> null state", async () => {
    const none = buildLiveAdapters(fakeDeps({ getChampion: async () => null }), now);
    expect(await none.getChampionState("biz")).toBeNull();
    const silent = buildLiveAdapters(fakeDeps({ fetchInsights: async () => [] }), now);
    expect(await silent.getChampionState("biz")).toBeNull();
  });

  it("revenue gate: 3 orders across 2+ days opens; fewer stays closed", async () => {
    const open = buildLiveAdapters(fakeDeps(), now);
    expect((await open.revenueGate("biz")).allowed).toBe(true);
    const closed = buildLiveAdapters(
      fakeDeps({ listAttributedOrderTimes: async () => [daysAgo(1)] }),
      now,
    );
    expect((await closed.revenueGate("biz")).allowed).toBe(false);
  });
});
