import { describe, expect, it } from "vitest";
import { totalPlannedUsdMinor, type ApprovalPlanPayload } from "./plan-payload";

const plan: ApprovalPlanPayload = {
  planDate: "2026-07-13",
  currency: "USD",
  championBudgetUsdMinor: 700,
  challengers: [
    { conceptId: "c1", hook: "h1", copy: "x", budgetUsdMinor: 150 },
    { conceptId: "c2", hook: "h2", copy: "y", budgetUsdMinor: 150 },
  ],
  commentary: [],
  scoreboard: { note: "first run" },
};

describe("totalPlannedUsdMinor", () => {
  it("sums champion + challengers", () => {
    expect(totalPlannedUsdMinor(plan)).toBe(1000);
  });

  it("handles a champion-only plan", () => {
    expect(totalPlannedUsdMinor({ ...plan, challengers: [] })).toBe(700);
  });
});
