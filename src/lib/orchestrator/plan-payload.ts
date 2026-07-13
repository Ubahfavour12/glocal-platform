/**
 * The shape of the plan payload stored in approvals.payload (jsonb) and
 * rendered by the approval card. Kept separate from the orchestrator's rich
 * types so the UI has a stable, serialisable contract (Blueprint §2.2).
 */

export interface PlanChallengerPayload {
  conceptId: string;
  hook: string;
  copy: string;
  budgetUsdMinor: number;
  mediaUrl?: string;
}

export interface PlanScoreboardPayload {
  metricUsed?: "roas" | "cpci" | "engagement";
  winnerHook?: string;
  note: string;
}

export interface ApprovalPlanPayload {
  planDate: string;
  currency: string;
  championBudgetUsdMinor: number;
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
