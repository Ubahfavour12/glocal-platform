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

export const PIPELINE_TARGET = 50;
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
): Promise<PipelineResult> {
  const existing = await deps.countConcepts(businessId);
  if (existing >= PIPELINE_TARGET) {
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
  const want = Math.min(BATCH_SIZE, PIPELINE_TARGET - existing);

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
      target: PIPELINE_TARGET,
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
