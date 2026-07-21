/**
 * Nightly orchestrator — TRD §4.1, Blueprint §4 "The Daily Autonomous Loop".
 * One run per business per evening:
 *
 *   context → verdict → plan → render → gateway → approval → (morning) launch
 *
 * Design rules enforced here, not in prompts:
 *  - Budget changes pass through clampBudgetIncrease (30%/24h hard cap).
 *  - Splits are persona-based and integer-exact.
 *  - Every creative must pass the Compliance Gateway; a block substitutes the
 *    next-ranked concept (max 2 substitutions, then the slot is dropped).
 *  - Nothing launches without an approved plan (unless full_auto).
 *  - Every step is an idempotent unit that records to the audit log.
 *
 * Adapters (DB, Meta, Higgsfield, push) are injected so the pipeline is
 * fully testable offline and lights up service-by-service as keys arrive.
 */

import { clampBudgetIncrease, personaSplit, type PersonaMode } from "@/lib/guardrails/budget";
import { decideVerdict, type CandidateMetrics, type Verdict } from "@/lib/verdicts/verdict";
import { checkFatigue, type FatigueInput, type StyleDirective } from "@/lib/verdicts/fatigue";
import { runGateway, type CreativeInput, type GatewayResult } from "@/lib/compliance/gateway";

// ---------- domain types ----------

export interface BusinessContext {
  businessId: string;
  name: string;
  category: string;
  goal: "sales" | "leads" | "whatsapp" | "visits";
  persona: PersonaMode;
  fullAuto: boolean;
  dailyBudgetUsdMinor: number;
  /** Yesterday's champion budget, for the escalation cap. */
  currentChampionBudgetUsdMinor: number | null;
  storeConnected: boolean;
  walletBalanceUsdMinor: number;
  countries: string[];
}

export interface Concept {
  id: string;
  rank: number;
  hook: string;
  copy: string;
  cta: string;
}

export interface RenderedCreative {
  conceptId: string;
  mediaUrl: string;
  copy: string;
}

export interface PlanChallenger {
  concept: Concept;
  budgetUsdMinor: number;
  creative?: RenderedCreative;
  gateway?: GatewayResult;
}

export interface NightlyPlan {
  businessId: string;
  planDate: string; // YYYY-MM-DD
  verdict: Verdict | null;
  /** "style_refresh" when the champion shows fatigue — tomorrow's concepts must diverge in style. */
  styleDirective: StyleDirective;
  championBudgetUsdMinor: number;
  challengers: PlanChallenger[];
  /** Human-readable agent commentary for the approval card. */
  commentary: string[];
  status: "ready_for_approval" | "auto_approved" | "insufficient_funds";
}

// ---------- adapters (injected) ----------

export interface OrchestratorAdapters {
  /** Open A/B test candidates with their windowed metrics. */
  getOpenTestCandidates(businessId: string): Promise<CandidateMetrics[]>;
  /** Champion reign state for fatigue detection — null when no champion yet. */
  getChampionState?(businessId: string): Promise<FatigueInput | null>;
  /** Next unrendered concepts, best rank first. */
  getNextConcepts(businessId: string, count: number): Promise<Concept[]>;
  /** Higgsfield render — absent until the key lands. */
  renderCreative?(businessId: string, concept: Concept): Promise<RenderedCreative>;
  /** LLM gateway layer — absent until the Anthropic key lands. */
  llmGatewayScan?(input: CreativeInput): Promise<GatewayResult>;
  /** Persist the plan and (when configured) send the approval push. */
  savePlan(plan: NightlyPlan): Promise<void>;
  /** Audit trail — every step, every run. */
  audit(businessId: string, action: string, detail: unknown): Promise<void>;
}

// ---------- the pipeline ----------

const CHALLENGERS_PER_DAY = 2;
const MAX_GATEWAY_SUBSTITUTIONS = 2;

export async function runNightly(
  ctx: BusinessContext,
  adapters: OrchestratorAdapters,
  now: Date = new Date(),
): Promise<NightlyPlan> {
  const planDate = nextDayIso(now);
  const commentary: string[] = [];

  // 1. VERDICT — judge yesterday's duel (only on thresholds; never early).
  const candidates = await adapters.getOpenTestCandidates(ctx.businessId);
  let verdict: Verdict | null = null;
  if (candidates.length >= 2) {
    verdict = decideVerdict(candidates, { storeConnected: ctx.storeConnected, now });
    await adapters.audit(ctx.businessId, "verdict", verdict);
    commentary.push(
      verdict.status === "decided"
        ? `Yesterday's duel has a winner (${verdict.metricUsed.toUpperCase()}). I'm making it the champion.`
        : `No verdict yet — ${verdict.reason}. The duel continues; I won't judge on thin data.`,
    );
  }

  // 1b. FATIGUE — metric-driven champion check; the crown stays, the style rotates.
  let styleDirective: StyleDirective = "none";
  if (adapters.getChampionState) {
    const championState = await adapters.getChampionState(ctx.businessId);
    if (championState) {
      const fatigue = checkFatigue(championState, now);
      if (fatigue.directive === "style_refresh") {
        styleDirective = "style_refresh";
        await adapters.audit(ctx.businessId, "fatigue", fatigue);
        commentary.push(
          `The champion is showing fatigue (${fatigue.reasons[0]}). It keeps its crown, but tomorrow's challengers will attack from a completely different style.`,
        );
      }
    }
  }

  // 2. BUDGET — persona split under the hard escalation cap.
  const spendableToday = Math.min(ctx.dailyBudgetUsdMinor, ctx.walletBalanceUsdMinor);
  if (spendableToday < ctx.dailyBudgetUsdMinor) {
    commentary.push(
      ctx.walletBalanceUsdMinor <= 0
        ? "Your wallet is empty — I can't plan tomorrow's ads until you add funds."
        : "Your balance covers less than a full day — topping up keeps the learning uninterrupted.",
    );
  }
  if (spendableToday <= 0) {
    const plan: NightlyPlan = {
      businessId: ctx.businessId,
      planDate,
      verdict,
      styleDirective,
      championBudgetUsdMinor: 0,
      challengers: [],
      commentary,
      status: "insufficient_funds",
    };
    await adapters.savePlan(plan);
    return plan;
  }

  const split = personaSplit(spendableToday, ctx.persona, CHALLENGERS_PER_DAY);
  const championBudget =
    ctx.currentChampionBudgetUsdMinor !== null
      ? clampBudgetIncrease(ctx.currentChampionBudgetUsdMinor, split.championUsdMinor)
      : split.championUsdMinor;
  if (championBudget < split.championUsdMinor) {
    commentary.push(
      "I wanted to raise the champion's budget faster, but I never increase more than 30% in a day — protecting the algorithm's learning phase.",
    );
  }

  // 3. CHALLENGERS — pull concepts, render (if renderer available), gateway-check.
  const challengers: PlanChallenger[] = [];
  const pool = await adapters.getNextConcepts(
    ctx.businessId,
    CHALLENGERS_PER_DAY + MAX_GATEWAY_SUBSTITUTIONS,
  );

  let poolIdx = 0;
  while (challengers.length < CHALLENGERS_PER_DAY && poolIdx < pool.length) {
    const concept = pool[poolIdx++];
    const creative = adapters.renderCreative
      ? await adapters.renderCreative(ctx.businessId, concept)
      : undefined;

    const gateway = await runGateway(
      {
        copy: creative?.copy ?? concept.copy,
        category: ctx.category,
        destinationKind: ctx.goal === "whatsapp" ? "whatsapp" : "url",
      },
      adapters.llmGatewayScan,
    );
    await adapters.audit(ctx.businessId, "gateway_scan", {
      conceptId: concept.id,
      verdict: gateway.verdict,
      riskScore: gateway.riskScore,
    });

    if (gateway.verdict === "block") {
      commentary.push(
        `I rejected one of my own drafts ("${concept.hook.slice(0, 40)}…") — it wouldn't survive the ad network's policy review. Substituting the next concept.`,
      );
      continue; // substitution: next concept from the pool
    }
    challengers.push({
      concept,
      budgetUsdMinor: split.challengerUsdMinor[challengers.length],
      creative,
      gateway,
    });
  }

  if (challengers.length < CHALLENGERS_PER_DAY) {
    commentary.push(
      `Only ${challengers.length} of ${CHALLENGERS_PER_DAY} challenger slots filled — the concept pool needs replenishing.`,
    );
  }

  // 4. APPROVAL — full-auto skips the gate (opt-in setting, off by default).
  const plan: NightlyPlan = {
    businessId: ctx.businessId,
    planDate,
    verdict,
    styleDirective,
    championBudgetUsdMinor: championBudget,
    challengers,
    commentary,
    status: ctx.fullAuto ? "auto_approved" : "ready_for_approval",
  };
  await adapters.savePlan(plan);
  await adapters.audit(ctx.businessId, "plan_created", {
    planDate,
    status: plan.status,
    champion: championBudget,
    challengers: challengers.map((c) => ({ id: c.concept.id, budget: c.budgetUsdMinor })),
  });
  return plan;
}

function nextDayIso(now: Date): string {
  const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
