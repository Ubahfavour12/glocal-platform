import { describe, expect, it } from "vitest";
import {
  checkFatigue,
  updatePeakCtr,
  CTR_DECAY_THRESHOLD,
  FREQUENCY_THRESHOLD,
  MAX_REIGN_DAYS,
} from "./fatigue";

const now = new Date("2026-07-13T18:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const base = {
  championSince: daysAgo(3),
  peakCtr: 0.04,
  currentCtr: 0.04,
  frequency: 1.2 as number | null,
};

describe("checkFatigue — metric-driven, not calendar-driven", () => {
  it("healthy young champion: no directive", () => {
    const r = checkFatigue(base, now);
    expect(r.directive).toBe("none");
    expect(r.reasons).toHaveLength(0);
  });

  it("a long reign alone does NOT trigger before the backstop", () => {
    // day 8 champion with healthy metrics — the whole point vs a 5-day timer
    const r = checkFatigue({ ...base, championSince: daysAgo(8) }, now);
    expect(r.directive).toBe("none");
  });

  it("CTR decay beyond threshold triggers a style refresh", () => {
    // peak 4%, now 2.8% = 30% decay > 25%
    const r = checkFatigue({ ...base, currentCtr: 0.028 }, now);
    expect(r.directive).toBe("style_refresh");
    expect(r.reasons.join(" ")).toMatch(/decayed/);
  });

  it("decay at exactly the threshold does not trigger", () => {
    const exactly = base.peakCtr * (1 - CTR_DECAY_THRESHOLD);
    const r = checkFatigue({ ...base, currentCtr: exactly }, now);
    expect(r.directive).toBe("none");
  });

  it("high frequency triggers even with healthy CTR", () => {
    const r = checkFatigue({ ...base, frequency: FREQUENCY_THRESHOLD + 0.6 }, now);
    expect(r.directive).toBe("style_refresh");
    expect(r.reasons.join(" ")).toMatch(/frequency/);
  });

  it("missing reach data (frequency null) is tolerated", () => {
    const r = checkFatigue({ ...base, frequency: null }, now);
    expect(r.directive).toBe("none");
  });

  it("the day-10 backstop fires regardless of metrics", () => {
    const r = checkFatigue({ ...base, championSince: daysAgo(MAX_REIGN_DAYS) }, now);
    expect(r.directive).toBe("style_refresh");
    expect(r.reasons.join(" ")).toMatch(/backstop/);
  });

  it("multiple signals stack into multiple reasons", () => {
    const r = checkFatigue(
      { championSince: daysAgo(11), peakCtr: 0.04, currentCtr: 0.02, frequency: 3.4 },
      now,
    );
    expect(r.directive).toBe("style_refresh");
    expect(r.reasons.length).toBe(3);
  });
});

describe("updatePeakCtr", () => {
  it("ratchets upward only", () => {
    expect(updatePeakCtr(0.03, 0.04)).toBe(0.04);
    expect(updatePeakCtr(0.04, 0.02)).toBe(0.04);
  });

  it("ignores invalid values", () => {
    expect(updatePeakCtr(0.03, NaN)).toBe(0.03);
    expect(updatePeakCtr(0.03, -1)).toBe(0.03);
  });
});
