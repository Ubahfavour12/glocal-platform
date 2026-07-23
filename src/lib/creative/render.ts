/**
 * Render orchestration — Phase 2.3 (Blueprint §3 "Production").
 * The lane that turns a scripted concept + the customer's product photo into a
 * finished creative, respecting the daily render quota. Only the concepts
 * entering today's test are rendered (2/day on the entry tier), never the full
 * 50-concept pool — that is the whole cost-control design.
 *
 * Pure orchestration with injected deps (submit/poll/sleep/persist), so the
 * async job loop is fixture-tested offline and lights up on real Higgsfield
 * when the key + a stored source image are present.
 */

import type { CreativeKind, Placement, RenderConceptInput } from "@/lib/higgsfield/client";
import { canRender, remainingRenders, type QuotaState } from "./quota";

export interface RenderableConcept {
  conceptId: string;
  /** the visual idea (built from the concept's hook / storyboard) */
  prompt: string;
}

export interface RenderedCreative {
  conceptId: string;
  mediaUrl: string;
  kind: CreativeKind;
}

export interface RenderOptions {
  sourceImageUrl: string; // the business's stored product photo (absolute URL)
  kind: CreativeKind;
  placement: Placement;
  quota: QuotaState;
  /** max poll attempts before giving up on a job (default 20) */
  maxPolls?: number;
  /** ms between polls (default 3000; deps.sleep is a no-op in tests) */
  pollIntervalMs?: number;
}

export interface JobStatus {
  state: "queued" | "processing" | "done" | "failed";
  mediaUrl?: string;
  error?: string;
}

export interface RenderDeps {
  submit(input: RenderConceptInput): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<JobStatus>;
  sleep(ms: number): Promise<void>;
  /** persist the finished creative (Supabase Storage copy + creatives row). */
  persist(conceptId: string, mediaUrl: string, kind: CreativeKind): Promise<void>;
  audit?(action: string, detail: unknown): Promise<void>;
}

export interface RenderSummary {
  rendered: RenderedCreative[];
  skippedForQuota: number;
  failed: { conceptId: string; error: string }[];
}

/**
 * Render as many of `concepts` as the quota allows, in order. Each render is
 * submit -> poll-until-terminal -> persist. A failure or timeout on one
 * concept never blocks the others.
 */
export async function renderConcepts(
  concepts: RenderableConcept[],
  opts: RenderOptions,
  deps: RenderDeps,
): Promise<RenderSummary> {
  const budget = remainingRenders(opts.quota);
  const toRender = concepts.slice(0, budget);
  const skippedForQuota = concepts.length - toRender.length;

  const rendered: RenderedCreative[] = [];
  const failed: { conceptId: string; error: string }[] = [];
  const maxPolls = opts.maxPolls ?? 20;
  const interval = opts.pollIntervalMs ?? 3000;

  for (const concept of toRender) {
    try {
      const input: RenderConceptInput = {
        conceptId: concept.conceptId,
        prompt: concept.prompt,
        sourceImageUrl: opts.sourceImageUrl,
        kind: opts.kind,
        placement: opts.placement,
      };
      const { jobId } = await deps.submit(input);

      let status: JobStatus = { state: "queued" };
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        status = await deps.poll(jobId);
        if (status.state === "done" || status.state === "failed") break;
        await deps.sleep(interval);
      }

      if (status.state === "done" && status.mediaUrl) {
        await deps.persist(concept.conceptId, status.mediaUrl, opts.kind);
        rendered.push({ conceptId: concept.conceptId, mediaUrl: status.mediaUrl, kind: opts.kind });
      } else {
        failed.push({
          conceptId: concept.conceptId,
          error: status.error ?? (status.state === "done" ? "no media url" : "render timed out"),
        });
      }
    } catch (e) {
      failed.push({ conceptId: concept.conceptId, error: (e as Error).message.slice(0, 160) });
    }
  }

  const summary: RenderSummary = { rendered, skippedForQuota, failed };
  await deps.audit?.("render_batch", {
    requested: concepts.length,
    rendered: rendered.length,
    skippedForQuota,
    failed: failed.length,
  });
  return summary;
}

/** Whether the business can render at all today (quota + a source image). */
export function canRenderToday(quota: QuotaState, sourceImageUrl: string | null): boolean {
  return canRender(quota) && !!sourceImageUrl && /^https?:\/\//i.test(sourceImageUrl);
}

/** Build the render prompt from a concept's hook + storyboard beats. */
export function promptFromConcept(hook: string, storyboard: string[]): string {
  const beats = storyboard.filter(Boolean).join("; ");
  return beats ? `${hook}. ${beats}` : hook;
}
