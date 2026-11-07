import { describe, expect, it } from "vitest";
import { isDormant, type DormancySignals } from "./dormant";

const signals = (over: Partial<DormancySignals> = {}): DormancySignals => ({
  hasAdAccount: false,
  hasSocial: false,
  balanceUsdMinor: 0,
  ...over,
});

describe("isDormant", () => {
  it("is dormant only when all three signals are absent", () => {
    expect(isDormant(signals())).toBe(true);
  });

  it("is awake on any single signal", () => {
    // Table over every combination. Erring toward RUNNING is the whole policy:
    // wasted tokens are cheap, a customer whose agent silently stopped is not.
    const cases: [Partial<DormancySignals>, boolean][] = [
      [{}, true],
      [{ hasAdAccount: true }, false],
      [{ hasSocial: true }, false],
      [{ balanceUsdMinor: 1 }, false],
      [{ hasAdAccount: true, hasSocial: true }, false],
      [{ hasAdAccount: true, balanceUsdMinor: 500 }, false],
      [{ hasSocial: true, balanceUsdMinor: 500 }, false],
      [{ hasAdAccount: true, hasSocial: true, balanceUsdMinor: 500 }, false],
    ];
    for (const [over, expected] of cases) {
      expect(isDormant(signals(over))).toBe(expected);
    }
  });

  it("keeps the Organic tier running", () => {
    // THE CASE THAT MAKES THIS A PREDICATE AND NOT AN INLINE &&. Organic has no
    // wallet and no ad account on purpose; it posts to a connected page. A gate
    // that checked only "can it advertise" would switch off the whole free tier.
    expect(isDormant(signals({ hasSocial: true }))).toBe(false);
  });

  it("treats a missing or nonsense balance as no money", () => {
    expect(isDormant(signals({ balanceUsdMinor: Number.NaN }))).toBe(true);
    expect(isDormant(signals({ balanceUsdMinor: -100 }))).toBe(true);
  });

  it("a funded account with nothing connected still runs", () => {
    // They have paid. Whatever else is missing, they are owed a plan ready for
    // the moment they connect.
    expect(isDormant(signals({ balanceUsdMinor: 25_00 }))).toBe(false);
  });
});
