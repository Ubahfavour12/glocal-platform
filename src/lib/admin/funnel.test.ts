import { describe, expect, it } from "vitest";
import { funnel, walletFloatUsdMinor, worstDrop, type BusinessProgress } from "./funnel";

const biz = (over: Partial<BusinessProgress> = {}): BusinessProgress => ({
  businessId: Math.random().toString(36).slice(2),
  onboarded: true,
  connected: false,
  funded: false,
  launched: false,
  ...over,
});

describe("funnel", () => {
  it("names the wall when everyone stops at the same step", () => {
    // PRODUCTION, ROUGHLY. Eight businesses, a few funded, nobody connected,
    // nobody launched. One line says what counting rows in the database took.
    const steps = funnel([
      ...Array.from({ length: 5 }, () => biz()),
      ...Array.from({ length: 3 }, () => biz({ funded: true })),
    ]);
    expect(steps.map((s) => [s.key, s.count])).toEqual([
      ["signed_up", 8],
      ["onboarded", 8],
      ["connected", 0],
      ["funded", 3],
      ["launched", 0],
    ]);
    expect(worstDrop(steps)!.key).toBe("connected");
  });

  it("counts a funded business even when it never connected", () => {
    // Progress reached, not a path walked in order. Pretending otherwise
    // would hide the customer who paid and then got stuck.
    const steps = funnel([biz({ funded: true, connected: false })]);
    expect(steps.find((s) => s.key === "funded")!.count).toBe(1);
  });

  it("reports the drop between consecutive steps", () => {
    const steps = funnel([
      biz({ connected: true, funded: true, launched: true }),
      biz({ connected: true, funded: true }),
      biz({ connected: true }),
      biz({ onboarded: false }),
    ]);
    expect(steps.find((s) => s.key === "onboarded")!.droppedFromPrevious).toBe(1);
    expect(steps.find((s) => s.key === "launched")!.droppedFromPrevious).toBe(1);
  });

  it("has no worst drop when nobody is lost", () => {
    const steps = funnel([biz({ connected: true, funded: true, launched: true })]);
    expect(worstDrop(steps)).toBeNull();
  });

  it("is all zeroes with no customers rather than NaN", () => {
    expect(funnel([]).every((s) => s.count === 0)).toBe(true);
    expect(worstDrop(funnel([]))).toBeNull();
  });
});

describe("walletFloatUsdMinor", () => {
  it("adds up money being held that is not ours", () => {
    expect(walletFloatUsdMinor([1_000_000, 37_000, 1_000])).toBe(1_038_000);
  });

  it("ignores a negative or nonsense balance", () => {
    // A negative balance is a bug elsewhere; it must not quietly reduce the
    // float and make the obligation look smaller than it is.
    expect(walletFloatUsdMinor([500, -200, Number.NaN])).toBe(500);
  });

  it("is zero with no wallets", () => {
    expect(walletFloatUsdMinor([])).toBe(0);
  });
});
