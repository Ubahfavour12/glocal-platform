import { describe, expect, it } from "vitest";
import {
  canRender,
  overageCostUsdMinor,
  remainingRenders,
  splitAgainstQuota,
} from "./quota";

describe("render quota", () => {
  it("remaining and canRender track the daily limit", () => {
    expect(remainingRenders({ usedToday: 0, dailyLimit: 2 })).toBe(2);
    expect(remainingRenders({ usedToday: 2, dailyLimit: 2 })).toBe(0);
    expect(remainingRenders({ usedToday: 5, dailyLimit: 2 })).toBe(0); // never negative
    expect(canRender({ usedToday: 1, dailyLimit: 2 })).toBe(true);
    expect(canRender({ usedToday: 2, dailyLimit: 2 })).toBe(false);
  });

  it("splits wanted renders into in-quota and overage", () => {
    expect(splitAgainstQuota({ usedToday: 0, dailyLimit: 2 }, 2)).toEqual({
      withinQuota: 2,
      overage: 0,
    });
    expect(splitAgainstQuota({ usedToday: 1, dailyLimit: 2 }, 3)).toEqual({
      withinQuota: 1,
      overage: 2,
    });
    expect(splitAgainstQuota({ usedToday: 2, dailyLimit: 2 }, 2)).toEqual({
      withinQuota: 0,
      overage: 2,
    });
  });

  it("prices overage at the à-la-carte markup, rounding up", () => {
    // 2 extra renders, 40c cost each, 2x markup => 160c
    expect(overageCostUsdMinor(2, 40)).toBe(160);
    expect(overageCostUsdMinor(0, 40)).toBe(0);
    expect(overageCostUsdMinor(1, 33, 2.5)).toBe(83); // ceil(82.5)
  });
});
