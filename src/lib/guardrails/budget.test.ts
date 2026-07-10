import { describe, expect, it } from "vitest";
import { clampBudgetIncrease, personaSplit } from "./budget";

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

describe("personaSplit", () => {
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
    expect(() => personaSplit(1000, "smart", 0)).toThrow();
  });
});
