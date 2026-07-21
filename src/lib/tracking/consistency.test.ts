import { describe, expect, it } from "vitest";
import { revenueJudgingAllowed, MIN_ATTRIBUTED_ORDERS } from "./consistency";
import { decideVerdict, type CandidateMetrics } from "@/lib/verdicts/verdict";
import type { AttributedOrder } from "./attribution";

const now = new Date("2026-07-21T20:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const sale = (h: number, code: string | null = "GL-1"): AttributedOrder => ({
  code,
  codeSource: code === null ? "none" : "message",
  valueUsdMinor: 10_000,
  source: "manual",
  at: hoursAgo(h),
});

describe("revenueJudgingAllowed — the consistency gate", () => {
  it("opens with steady marking: 3+ sales across 2+ days", () => {
    const r = revenueJudgingAllowed([sale(2), sale(20), sale(30)], now);
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/revenue judging on/);
  });

  it("stays closed on too few sales", () => {
    const r = revenueJudgingAllowed([sale(2), sale(30)], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/cost per conversation/);
  });

  it("stays closed when all marking happened in one burst (single day)", () => {
    const r = revenueJudgingAllowed([sale(1), sale(2), sale(3)], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/single day/);
  });

  it("unattributed sales do not open the gate", () => {
    const orders = Array.from({ length: MIN_ATTRIBUTED_ORDERS + 2 }, (_, i) =>
      sale(i * 20, null),
    );
    expect(revenueJudgingAllowed(orders, now).allowed).toBe(false);
  });

  it("sales outside the rolling window do not count", () => {
    const r = revenueJudgingAllowed([sale(2), sale(100), sale(120)], now);
    expect(r.allowed).toBe(false);
  });
});

describe("decideVerdict — revenueTrusted activates ROAS without a store", () => {
  const day = (offset: number, revenue: number, intents: number) => ({
    date: hoursAgo(offset * 24),
    impressions: 6_000,
    clicks: 200,
    intents,
    spendUsdMinor: 1_000,
    revenueUsdMinor: revenue,
  });
  const candidates: CandidateMetrics[] = [
    { adId: "A", startedAt: hoursAgo(60), daily: [day(0, 40_000, 10), day(1, 30_000, 12)] },
    { adId: "B", startedAt: hoursAgo(60), daily: [day(0, 5_000, 30), day(1, 4_000, 28)] },
  ];

  it("with the gate open, revenue judges: A wins on ROAS", () => {
    const v = decideVerdict(candidates, { storeConnected: false, revenueTrusted: true, now });
    expect(v).toMatchObject({ status: "decided", winnerAdId: "A", metricUsed: "roas" });
  });

  it("with the gate closed, intents judge: B wins on CPCI", () => {
    const v = decideVerdict(candidates, { storeConnected: false, now });
    expect(v).toMatchObject({ status: "decided", winnerAdId: "B", metricUsed: "cpci" });
  });
});
