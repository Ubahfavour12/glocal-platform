import { describe, expect, it } from "vitest";
import {
  canRender,
  overageCostUsdMinor,
  remainingRenders,
  splitAgainstQuota,
  VIDEO_CREDIT_WEIGHT,
  creditsFor,
  canRenderKind,
  remainingOfKind,
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

describe("video credit weighting", () => {
  it("charges a video more of the daily allowance than an image", () => {
    // A video costs the vendor 10-40x an image. Spending one credit on it
    // would make the cheapest customer the most expensive one.
    expect(creditsFor("image")).toBe(1);
    expect(creditsFor("video")).toBe(VIDEO_CREDIT_WEIGHT);
    expect(VIDEO_CREDIT_WEIGHT).toBeGreaterThan(1);
  });

  it("refuses a video that will not fit, before it is offered", () => {
    const q = { usedToday: 0, dailyLimit: 2 };
    expect(canRenderKind(q, "image")).toBe(true);
    expect(canRenderKind(q, "video")).toBe(false);
  });

  it("allows a video once the allowance covers it", () => {
    expect(canRenderKind({ usedToday: 0, dailyLimit: 4 }, "video")).toBe(true);
  });

  it("reports how many of each kind are still affordable", () => {
    const q = { usedToday: 0, dailyLimit: 8 };
    expect(remainingOfKind(q, "image")).toBe(8);
    expect(remainingOfKind(q, "video")).toBe(2);
  });

  it("never reports a negative allowance when the cap is already blown", () => {
    const q = { usedToday: 99, dailyLimit: 2 };
    expect(remainingOfKind(q, "video")).toBe(0);
    expect(canRenderKind(q, "video")).toBe(false);
  });
});
