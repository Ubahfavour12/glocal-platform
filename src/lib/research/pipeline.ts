/**
 * Pipeline builder — Phase 2.1 (Blueprint: "50 concepts upfront", PRD F-03).
 * The moment the agent comes alive after signup: research the niche, write
 * concepts, fill the customer's pipeline in the database.
 *
 * Built INCREMENTALLY: one batch (10) per invocation, topped up nightly until
 * the target (50). The first batch lands right after onboarding, which is
 * plenty for days of duels (2 challengers/day); increments keep every run
 * fast, cheap, and inside serverless time limits, and the system self-heals
 * if any batch fails. Scrape failure degrades to concept generation without
 * viral patterns rather than blocking the pipeline.
 */

import type { ViralVideo } from "./youtube";
import type { AdConcept, ProductBrief } from "./concepts";
import type { RenderTier } from "@/lib/billing/plan";

/**
 * The pool a Scale account carries. Kept as the name other modules import.
 *
 * Use `pipelineTargetFor(tier)` for anything that knows whose pipeline it is:
 * this value is the ceiling, not the rule.
 */
export const PIPELINE_TARGET = 50;

/**
 * How many concepts to keep on hand, by tier.
 *
 * This used to be 50 for everyone, which was the single most expensive line in
 * the product and bought nothing at the bottom. Concept generation is the
 * largest variable cost per account, and a micro business runs ONE ad at a
 * time: it cannot consume fifty concepts in any reasonable period, so roughly
 * four fifths of that spend was inventory that would never be used. A free
 * account, which gets exactly one render ever, was having fifty written for it.
 *
 * The numbers follow consumption, not generosity. A duel burns two challengers
 * a day, so Scale's twelve renders a day genuinely churn a deep pool; Spark
 * rotates one ad every few days and does not.
 *
 * Deliberately not proportional to price. The pool only has to stay ahead of
 * what the tier can actually run, and past that point a bigger number is cost
 * with no customer-visible effect.
 */
const TARGET_BY_TIER: Record<RenderTier, number> = {
  free: 10,
  starter: 25,
  growth: 40,
  scale: PIPELINE_TARGET,
};

/**
 * Pure: the concept pool size for a tier.
 *
 * An unrecognised tier resolves to the smallest pool, the same direction
 * `asTier` errs in: a tier someone adds to pricing before adding it here costs
 * the least until it is mapped, rather than quietly buying the most.
 */
export function pipelineTargetFor(tier: RenderTier | null | undefined): number {
  return tier && tier in TARGET_BY_TIER ? TARGET_BY_TIER[tier] : TARGET_BY_TIER.free;
}
export const BATCH_SIZE = 10;

/** Keywords the scraper searches for this niche. Two keeps YouTube quota sane. */
export function buildNicheKeywords(category: string): string[] {
  const c = category.trim().toLowerCase();
  return [`${c} ad`, `${c} commercial`];
}

export interface ConceptRow {
  business_id: string;
  rank: number;
  hook: string;
  storyboard: string[];
  copy_angle: string;
  cta: string;
  source_pattern: string | null;
}

/** Map generated concepts to DB rows, ranks continuing after what exists. */
export function conceptRowsFrom(
  businessId: string,
  concepts: AdConcept[],
  rankOffset = 0,
): ConceptRow[] {
  return concepts.map((c, i) => ({
    business_id: businessId,
    rank: rankOffset + i + 1,
    hook: c.hook,
    storyboard: c.storyboard ?? [],
    copy_angle: c.copyAngle,
    cta: c.cta,
    source_pattern: c.sourcePattern ?? null,
  }));
}

// ---------- orchestration (deps injected; fully testable offline) ----------

export interface PipelineDeps {
  getBusiness(businessId: string): Promise<ProductBrief | null>;
  countConcepts(businessId: string): Promise<number>;
  listExistingHooks(businessId: string): Promise<string[]>;
  scrape(keywords: string[]): Promise<ViralVideo[]>;
  generate(
    brief: ProductBrief,
    viral: ViralVideo[],
    count: number,
    avoidHooks: string[],
  ): Promise<AdConcept[]>;
  insertConcepts(rows: ConceptRow[]): Promise<void>;
  audit(businessId: string, action: string, detail: unknown): Promise<void>;
}

export interface PipelineResult {
  status: "full" | "built" | "error";
  added: number;
  total: number;
  detail?: string;
}

export async function buildPipelineBatch(
  deps: PipelineDeps,
  businessId: string,
  tier: RenderTier = "scale",
): Promise<PipelineResult> {
  const target = pipelineTargetFor(tier);
  const existing = await deps.countConcepts(businessId);
  if (existing >= target) {
    return { status: "full", added: 0, total: existing };
  }

  const brief = await deps.getBusiness(businessId);
  if (!brief) {
    return { status: "error", added: 0, total: existing, detail: "business not found" };
  }

  // Research is best-effort: quota exhaustion or a missing key must never
  // block the pipeline — concepts still generate from the brief alone.
  let viral: ViralVideo[] = [];
  let researchNote = "with niche research";
  try {
    viral = await deps.scrape(buildNicheKeywords(brief.category));
  } catch (e) {
    researchNote = `without research (${(e as Error).message.slice(0, 120)})`;
  }

  const avoid = existing > 0 ? await deps.listExistingHooks(businessId) : [];
  const want = Math.min(BATCH_SIZE, target - existing);

  try {
    const concepts = await deps.generate(brief, viral, want, avoid);
    if (concepts.length === 0) {
      return { status: "error", added: 0, total: existing, detail: "no concepts generated" };
    }
    await deps.insertConcepts(conceptRowsFrom(businessId, concepts, existing));
    const total = existing + concepts.length;
    await deps.audit(businessId, "pipeline_batch", {
      added: concepts.length,
      total,
      target,
      research: researchNote,
      viralPatterns: viral.length,
    });
    return { status: "built", added: concepts.length, total };
  } catch (e) {
    return {
      status: "error",
      added: 0,
      total: existing,
      detail: (e as Error).message.slice(0, 200),
    };
  }
}
