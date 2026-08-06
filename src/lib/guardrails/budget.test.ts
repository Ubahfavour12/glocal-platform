import { describe, expect, it } from "vitest";
import { clampBudgetIncrease, personaSplit, viableChallengerCount } from "./budget";

describe("clampBudgetIncrease — the 30% hard cap", () => {
  it("caps increases at current × 1.30", () => {
    expect(clampBudgetIncrease(1000, 2000)).toBe(1300);
    expect(clampBudgetIncrease(1000, 1300)).toBe(1300);
  });

  it("passes through increases under the cap", () => {
    expect(clampBudgetIncrease(1000, 1200)).toBe(1200);
  });

  it("always allows decreases and holds", () => {
    expect(clampBudgetIncrease(1000, 400)).toBe(400);
    expect(clampBudgetIncrease(1000, 1000)).toBe(1000);
    expect(clampBudgetIncrease(1000, 0)).toBe(0);
  });

  it("a doubling attempt is impossible even via repeated same-day calls", () => {
    // The cap is stateless per cycle: applying it twice to the same current
    // budget cannot exceed 1.30× — proving prompt-side escalation can't
    // bypass the code-side rail within one cycle.
    const first = clampBudgetIncrease(1000, 5000);
    const second = clampBudgetIncrease(1000, first + 5000);
    expect(first).toBe(1300);
    expect(second).toBe(1300);
  });

  it("rejects invalid inputs", () => {
    expect(() => clampBudgetIncrease(0, 100)).toThrow();
    expect(() => clampBudgetIncrease(100.5, 200)).toThrow();
    expect(() => clampBudgetIncrease(100, -1)).toThrow();
  });
});

describe("viableChallengerCount", () => {
  it("funds two challengers once the pool covers the minimum twice", () => {
    // smart = 30% pool. $20/day -> $6 pool -> two $3 challengers.
    expect(viableChallengerCount(2000, "smart").count).toBe(2);
    expect(viableChallengerCount(2000, "smart").note).toBeNull();
  });

  it("drops to one challenger rather than starving two", () => {
    // $10/day smart -> $3 pool -> exactly one viable challenger.
    const plan = viableChallengerCount(1000, "smart");
    expect(plan.count).toBe(1);
    expect(plan.note).toContain("1 new ad");
  });

  it("runs no duel at all when even one cannot be funded", () => {
    // $10/day conservative -> 20% -> $2 pool -> below the $3 minimum.
    const plan = viableChallengerCount(1000, "conservative");
    expect(plan.count).toBe(0);
    expect(plan.note).toContain("too small");
  });

  it("never returns more than the desired count", () => {
    expect(viableChallengerCount(50_000, "aggressive").count).toBe(2);
  });
});

describe("personaSplit", () => {
  it("gives the whole budget to the champion when there are no challengers", () => {
    const s = personaSplit(1000, "conservative", 0);
    expect(s.championUsdMinor).toBe(1000);
    expect(s.challengerUsdMinor).toEqual([]);
  });

  it("a single challenger gets the entire challenger pool", () => {
    const s = personaSplit(1000, "smart", 1);
    expect(s.challengerUsdMinor).toEqual([300]);
    expect(s.championUsdMinor).toBe(700);
  });

  it("Dynamic Split default: 70% champion, 30% split across challengers", () => {
    const s = personaSplit(1000, "smart", 2);
    expect(s.challengerUsdMinor).toEqual([150, 150]);
    expect(s.championUsdMinor).toBe(700);
  });

  it("conservative: 80/20", () => {
    const s = personaSplit(1000, "conservative", 2);
    expect(s.championUsdMinor).toBe(800);
    expect(s.challengerUsdMinor).toEqual([100, 100]);
  });

  it("aggressive: 60/40", () => {
    const s = personaSplit(1000, "aggressive", 2);
    expect(s.championUsdMinor).toBe(600);
    expect(s.challengerUsdMinor).toEqual([200, 200]);
  });

  it("is integer-exact: pieces always sum to the total", () => {
    for (const total of [999, 1001, 1234567, 1000]) {
      for (const persona of ["conservative", "smart", "aggressive"] as const) {
        const s = personaSplit(total, persona, 2);
        const sum = s.championUsdMinor + s.challengerUsdMinor.reduce((a, b) => a + b, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it("rejects invalid inputs", () => {
    expect(() => personaSplit(0, "smart")).toThrow();
    expect(() => personaSplit(1000, "smart", -1)).toThrow();
    expect(() => personaSplit(1000, "smart", 1.5)).toThrow();
  });
});
