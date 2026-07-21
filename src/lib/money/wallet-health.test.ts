import { describe, expect, it } from "vitest";
import { computeWalletHealth } from "./wallet-health";

const DAILY = 1000; // $10/day

describe("computeWalletHealth", () => {
  it("healthy above 3 days of runway, no warning", () => {
    const h = computeWalletHealth(10_000, DAILY); // 10 days
    expect(h.status).toBe("healthy");
    expect(h.runwayDays).toBe(10);
    expect(h.shouldWarn).toBe(false);
  });

  it("warns EARLY: low the moment runway drops under 3 days", () => {
    const h = computeWalletHealth(2_500, DAILY); // 2.5 days
    expect(h.status).toBe("low");
    expect(h.runwayDays).toBe(2);
    expect(h.shouldWarn).toBe(true);
    expect(h.message).toMatch(/2 days of budget left/i);
  });

  it("critical under one day of runway", () => {
    const h = computeWalletHealth(500, DAILY); // 0.5 days
    expect(h.status).toBe("critical");
    expect(h.message).toMatch(/runs out today/i);
    expect(h.shouldWarn).toBe(true);
  });

  it("empty at zero or below: spend paused", () => {
    const h = computeWalletHealth(0, DAILY);
    expect(h.status).toBe("empty");
    expect(h.runwayDays).toBe(0);
    expect(h.message).toMatch(/paused/i);
    expect(h.shouldWarn).toBe(true);
  });

  it("exactly 3 days is still healthy; just under is low", () => {
    expect(computeWalletHealth(3_000, DAILY).status).toBe("healthy");
    expect(computeWalletHealth(2_999, DAILY).status).toBe("low");
  });

  it("singular day phrasing at one day of runway", () => {
    const h = computeWalletHealth(1_000, DAILY); // exactly 1 day → low band
    expect(h.status).toBe("low");
    expect(h.message).toMatch(/1 day of budget/i);
  });
});
