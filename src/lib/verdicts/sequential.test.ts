import { describe, expect, it } from "vitest";
import {
  DAYS_PER_WEEK,
  MIN_BLOCK_DAYS,
  aggregateBlock,
  blockDays,
  decideSequential,
  weekdayHistogram,
  weekdayImbalance,
  type SequentialBlock,
} from "./sequential";
import { MIN_IMPRESSIONS, type DailyMetrics } from "./verdict";

/** A run of `days` consecutive days starting on `from` (a Monday by default). */
function block(
  adId: string,
  days: number,
  over: Partial<DailyMetrics> = {},
  from = new Date("2026-07-06T00:00:00Z"), // a Monday
): SequentialBlock {
  const daily: DailyMetrics[] = [];
  for (let i = 0; i < days; i++) {
    daily.push({
      date: new Date(from.getTime() + i * 86_400_000),
      impressions: Math.ceil(MIN_IMPRESSIONS / 7) + 100,
      clicks: 100,
      intents: 10,
      spendUsdMinor: 200,
      revenueUsdMinor: 0,
      ...over,
    });
  }
  return { adId, daily };
}

const opts = { storeConnected: false };

describe("block shape", () => {
  it("counts distinct days and collapses duplicates", () => {
    const b = block("a", 7);
    expect(blockDays(b)).toBe(7);
    b.daily.push({ ...b.daily[0] });
    expect(blockDays(b)).toBe(7);
  });

  it("covers each weekday exactly once in a whole week", () => {
    expect(weekdayHistogram(block("a", 7))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(weekdayHistogram(block("a", 14)).every((n) => n === 2)).toBe(true);
  });

  it("gives two whole-week runs a zero weekday imbalance, whenever they start", () => {
    // The point of whole weeks: the weekday confounder disappears by
    // construction, even when the runs start on different days.
    const mon = block("a", 7, {}, new Date("2026-07-06T00:00:00Z"));
    const thu = block("b", 7, {}, new Date("2026-07-09T00:00:00Z"));
    expect(weekdayImbalance(mon, thu)).toBe(0);
  });

  it("detects a weekday mismatch between ragged runs", () => {
    const monThu = block("a", 4, {}, new Date("2026-07-06T00:00:00Z"));
    const friMon = block("b", 4, {}, new Date("2026-07-10T00:00:00Z"));
    expect(weekdayImbalance(monThu, friMon)).toBeGreaterThan(0);
  });

  it("sums the whole block, with nothing cut off by date", () => {
    const agg = aggregateBlock(block("a", 7, { spendUsdMinor: 100, intents: 3 }));
    expect(agg.spendUsdMinor).toBe(700);
    expect(agg.intents).toBe(21);
  });
});

describe("when it refuses to judge", () => {
  it("waits for the second run", () => {
    const v = decideSequential([block("a", 7)], opts);
    expect(v.status).toBe("pending");
    expect(v.reason).toMatch(/exactly two runs/);
  });

  it("waits until each run reaches the minimum length", () => {
    const v = decideSequential([block("a", 3), block("b", 3)], opts);
    expect(v.status).toBe("pending");
    expect(v.reason).toMatch(new RegExp(`${MIN_BLOCK_DAYS} days`));
  });

  it("refuses a part-week run, because that compares weekdays as much as ads", () => {
    const v = decideSequential([block("a", 10), block("b", 10)], opts);
    expect(v.status).toBe("pending");
    expect(v.reason).toMatch(/whole weeks/);
  });

  it("refuses runs of different lengths", () => {
    const v = decideSequential([block("a", 7), block("b", 14)], opts);
    expect(v.status).toBe("pending");
    expect(v.reason).toMatch(/different lengths/);
  });

  it("refuses when too few people have seen an ad", () => {
    const v = decideSequential([block("a", 7, { impressions: 1 }), block("b", 7)], opts);
    expect(v.status).toBe("pending");
    expect(v.reason).toMatch(/not enough people/);
  });
});

describe("when it does judge", () => {
  const a = block("a", 7, { intents: 20, spendUsdMinor: 200 }); // cheaper per intent
  const b = block("b", 7, { intents: 5, spendUsdMinor: 200 });

  it("picks a winner using the same hierarchy as the duel", () => {
    const v = decideSequential([a, b], opts);
    expect(v.status).toBe("decided");
    expect(v.winnerAdId).toBe("a");
    expect(v.metricUsed).toBe("cpci");
  });

  it("never claims more than moderate confidence", () => {
    // Two runs separated in time cannot earn "high", however clean the
    // numbers look.
    for (const weeks of [1, 2, 4]) {
      const v = decideSequential(
        [
          block("a", DAYS_PER_WEEK * weeks, { intents: 20 }),
          block("b", DAYS_PER_WEEK * weeks, { intents: 5 }),
        ],
        opts,
      );
      expect(v.confidence === "low" || v.confidence === "moderate").toBe(true);
    }
  });

  it("is less confident after one week than after two", () => {
    const one = decideSequential([block("a", 7, { intents: 20 }), block("b", 7, { intents: 5 })], opts);
    const two = decideSequential(
      [block("a", 14, { intents: 20 }), block("b", 14, { intents: 5 })],
      opts,
    );
    expect(one.confidence).toBe("low");
    expect(two.confidence).toBe("moderate");
  });

  it("always names the confounder it cannot rule out", () => {
    const v = decideSequential([a, b], opts);
    expect(v.caveats.length).toBeGreaterThan(0);
    expect(v.caveats[0]).toMatch(/different times/);
  });

  it("speaks more cautiously than a duel would", () => {
    // A sequential result must not be reported in the duel's voice.
    const v = decideSequential([a, b], opts);
    expect(v.reason).toMatch(/not a head-to-head/);
    expect(v.reason).not.toMatch(/champion/i);
  });

  it("still lets revenue decide when a store is connected", () => {
    const rich = block("a", 7, { revenueUsdMinor: 10_000, spendUsdMinor: 200 });
    const poor = block("b", 7, { revenueUsdMinor: 100, spendUsdMinor: 200 });
    const v = decideSequential([rich, poor], { storeConnected: true });
    expect(v.metricUsed).toBe("roas");
    expect(v.winnerAdId).toBe("a");
  });

  it("judges an awareness run on attention, not clicks", () => {
    const counts = { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 };
    const bait = block("bait", 7, { clicks: 900, attention: { ...counts, reactions: 2 } });
    const real = block("real", 7, { clicks: 10, attention: { ...counts, saves: 40, shares: 30 } });
    const v = decideSequential([bait, real], { storeConnected: false, awareness: true });
    expect(v.metricUsed).toBe("attention");
    expect(v.winnerAdId).toBe("real");
  });
});
