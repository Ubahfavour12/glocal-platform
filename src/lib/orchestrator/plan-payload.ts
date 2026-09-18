/**
 * The shape of the plan payload stored in approvals.payload (jsonb) and
 * rendered by the approval card. Kept separate from the orchestrator's rich
 * types so the UI has a stable, serialisable contract (Blueprint §2.2).
 */

import type { MetricUsed } from "@/lib/verdicts/verdict";

export interface PlanChallengerPayload {
  conceptId: string;
  hook: string;
  copy: string;
  budgetUsdMinor: number;
  mediaUrl?: string;
}

export interface PlanScoreboardPayload {
  /**
   * Imported rather than restated. This union was previously hand-copied here,
   * so adding a metric to the verdict engine broke the build in an unrelated
   * file — the compiler caught it, but only after the drift already existed.
   */
  metricUsed?: MetricUsed;
  winnerHook?: string;
  note: string;
}

export interface ApprovalPlanPayload {
  planDate: string;
  currency: string;
  championBudgetUsdMinor: number;
  /** Which scaling persona produced this split, so the UI can explain it. */
  persona?: "conservative" | "smart" | "aggressive";
  challengers: PlanChallengerPayload[];
  commentary: string[];
  scoreboard: PlanScoreboardPayload;
}

export function totalPlannedUsdMinor(p: ApprovalPlanPayload): number {
  return (
    p.championBudgetUsdMinor +
    p.challengers.reduce((sum, c) => sum + c.budgetUsdMinor, 0)
  );
}
