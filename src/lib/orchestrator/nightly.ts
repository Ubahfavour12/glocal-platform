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

import {
  clampBudgetIncrease,
  personaSplit,
  viableChallengerCount,
  type ChallengerPlan,
  type PersonaMode,
} from "@/lib/guardrails/budget";
import { type MetricUsed, decideVerdict, type CandidateMetrics, type Verdict } from "@/lib/verdicts/verdict";
import { checkFatigue, type FatigueInput, type StyleDirective } from "@/lib/verdicts/fatigue";
import {
  decideSequential,
  rotationDecision,
  type SequentialBlock,
  type SequentialVerdict,
} from "@/lib/verdicts/sequential";
import type { RenderTier } from "@/lib/billing/plan";
import { computeWalletHealth } from "@/lib/money/wallet-health";
import { runGateway, type CreativeInput, type GatewayResult } from "@/lib/compliance/gateway";
import type { AdLanguage } from "@/lib/copy/language";

// ---------- domain types ----------

export interface BusinessContext {
  businessId: string;
  name: string;
  category: string;
  goal: "sales" | "leads" | "whatsapp" | "visits" | "awareness";
  persona: PersonaMode;
  fullAuto: boolean;
  dailyBudgetUsdMinor: number;
  /** Yesterday's champion budget, for the escalation cap. */
  currentChampionBudgetUsdMinor: number | null;
  storeConnected: boolean;
  /** Manual/pixel revenue passed the consistency gate (tracking/consistency.ts). */
  revenueTrusted?: boolean;
  walletBalanceUsdMinor: number;
  countries: string[];
  /**
   * The subscription tier. Spark runs sequential testing instead of the duel,
   * so the orchestrator has to know which it is. Absent behaves as a duel
   * tier, which is what every account did before Spark existed.
   */
  tier?: RenderTier;
  /** When the live ad went live, for the sequential rotation. */
  sparkLiveSince?: Date | null;
  /** Completed sequential runs available to compare. */
  sparkCompletedBlocks?: number;
  /**
   * The language the ads are written in.
   *
   * The orchestrator needs it for one reason: the compliance rules layer is
   * a set of English regexes, so copy in another language has to be routed
   * to the layer that can actually read it.
   */
  adLanguage?: AdLanguage;
}

export interface Concept {
  id: string;
  rank: number;
  hook: string;
  copy: string;
  cta: string;
  /** What it should become: "image" or "video". Absent means an image. */
  kind?: string | null;
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
  /**
   * The sequential verdict, on tiers that use it. Kept separate from
   * `verdict` rather than widened into it: a sequential result carries
   * caveats and a capped confidence that a duel verdict does not, and
   * flattening the two would lose exactly the hedging that makes it honest.
   */
  sequential?: SequentialVerdict;
}

// ---------- adapters (injected) ----------

export interface OrchestratorAdapters {
  /** Open A/B test candidates with their windowed metrics. */
  getOpenTestCandidates(businessId: string): Promise<CandidateMetrics[]>;
  /** Champion reign state for fatigue detection — null when no champion yet. */
  getChampionState?(businessId: string): Promise<FatigueInput | null>;
  /**
   * The last two completed/current runs, for sequential testing. Absent on
   * duel tiers, where it is never called.
   */
  getSequentialBlocks?(businessId: string): Promise<SequentialBlock[]>;
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

/**
 * What the winning metric actually means, in the owner's words.
 *
 * The old line printed the metric id in capitals, which is jargon everywhere
 * and a lie for awareness: an attention verdict says people stopped and kept
 * the ad, NOT that anyone bought. An owner who reads "winner" and assumes
 * sales will raise budget on a campaign that was never going to produce them.
 */
export function verdictHeadline(metric: MetricUsed): string {
  switch (metric) {
    case "roas":
      return "Yesterday's duel has a winner on revenue per naira spent.";
    case "cost_per_won":
      return "Yesterday's duel has a winner on what it costs to win a customer.";
    case "cpci":
      return "Yesterday's duel has a winner on what it costs to get an enquiry.";
    case "attention":
      return "Yesterday's duel has a winner on attention: more people saved, shared or watched it. That is reach and memory, not sales.";
    case "engagement":
      return "Yesterday's duel has a winner on click-through rate only, which is the weakest signal here.";
  }
}

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
    verdict = decideVerdict(candidates, {
      storeConnected: ctx.storeConnected,
      revenueTrusted: ctx.revenueTrusted,
      awareness: ctx.goal === "awareness",
      now,
    });
    await adapters.audit(ctx.businessId, "verdict", verdict);
    commentary.push(
      verdict.status === "decided"
        ? `${verdictHeadline(verdict.metricUsed)} I'm making it the champion.`
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
  // Runway-based warning: fires early (3 days out) so the customer can top up
  // before anything pauses. Same computation the wallet screen and notifier use.
  const walletHealth = computeWalletHealth(ctx.walletBalanceUsdMinor, ctx.dailyBudgetUsdMinor);
  if (walletHealth.shouldWarn) {
    commentary.push(walletHealth.message);
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

  // SEQUENTIAL vs DUEL. Spark has one budget, so it tests one ad at a time
  // across weeks instead of two side by side.
  //
  // Without this branch a Spark account falls into the duel's degradation:
  // viableChallengerCount returns 0 (correctly -- two funded ad sets are not
  // affordable), the champion keeps the whole budget, and the SAME AD RUNS
  // FOREVER while sequential.ts waits for a second block that never arrives.
  // The account would spend real money and learn nothing, which is the exact
  // failure this tier exists to escape.
  const sequentialMode = ctx.tier === "spark";
  let sequential: SequentialVerdict | undefined;

  let challengerPlan: ChallengerPlan;
  if (sequentialMode) {
    const rotation = rotationDecision({
      liveSince: ctx.sparkLiveSince ?? null,
      completedBlocks: ctx.sparkCompletedBlocks ?? 0,
      now,
    });

    if (rotation.action === "judge" && adapters.getSequentialBlocks) {
      sequential = decideSequential(await adapters.getSequentialBlocks(ctx.businessId), {
        storeConnected: ctx.storeConnected,
        revenueTrusted: ctx.revenueTrusted,
        awareness: ctx.goal === "awareness",
      });
      await adapters.audit(ctx.businessId, "sequential_verdict", sequential);
      commentary.push(sequential.reason);
      // The caveats go to the CUSTOMER, not just the journal. A sequential
      // result is weaker evidence than a duel's and saying so is the point.
      for (const c of sequential.caveats) commentary.push(c);
    } else {
      commentary.push(rotation.reason);
    }

    // One ad at a time, always. A rotate night starts the next one; a hold
    // night leaves the live ad alone.
    challengerPlan = { count: rotation.action === "hold" ? 0 : 1, note: null };
  } else {
    // How many challengers today's budget can genuinely fund. Starving two
    // challengers means neither reaches the verdict threshold, so we run fewer
    // (or none) rather than testing ads that can never be judged.
    challengerPlan = viableChallengerCount(spendableToday, ctx.persona, CHALLENGERS_PER_DAY);
    // Suppressed on Spark: that note tells the customer to raise their budget
    // to about $10/day "for the full daily test", which is an upsell out of a
    // test Spark is not running and never claimed to.
    if (challengerPlan.note) commentary.push(challengerPlan.note);
  }

  const split = personaSplit(spendableToday, ctx.persona, challengerPlan.count);
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

  // Two paths, because they have different people waiting on them.
  //
  // Regenerate runs with no renderer and someone watching a spinner. The
  // gateway scans do not depend on each other, so run the whole pool at once
  // and then walk the answers in rank order: the plan that comes out is
  // identical, it just arrives in one round trip instead of one per concept.
  //
  // The nightly run keeps its sequential shape. There a render happens first
  // and the scan reads the rendered copy, and renders are far too expensive to
  // do speculatively for concepts that may never be used.
  const scanAhead = adapters.renderCreative
    ? null
    : await Promise.all(
        pool.map((concept) =>
          runGateway(
            {
              copy: concept.copy,
              category: ctx.category,
              language: ctx.adLanguage,
              destinationKind: ctx.goal === "whatsapp" ? "whatsapp" : "url",
            },
            adapters.llmGatewayScan,
          ),
        ),
      );

  let poolIdx = 0;
  while (challengers.length < challengerPlan.count && poolIdx < pool.length) {
    const at = poolIdx++;
    const concept = pool[at];
    const creative = adapters.renderCreative
      ? await adapters.renderCreative(ctx.businessId, concept)
      : undefined;

    const gateway =
      scanAhead?.[at] ??
      (await runGateway(
        {
          copy: creative?.copy ?? concept.copy,
          category: ctx.category,
          language: ctx.adLanguage,
          destinationKind: ctx.goal === "whatsapp" ? "whatsapp" : "url",
        },
        adapters.llmGatewayScan,
      ));
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

  if (challengers.length < challengerPlan.count) {
    commentary.push(
      `Only ${challengers.length} of ${challengerPlan.count} challenger slots filled, the concept pool needs replenishing.`,
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
    sequential,
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
