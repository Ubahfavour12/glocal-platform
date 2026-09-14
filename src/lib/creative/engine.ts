/**
 * Render engine selection + failover.
 *
 * fal.ai is primary. Higgsfield stays configured as a standby and is used only
 * when fal cannot be reached. This is the one routing rule that needs no
 * evidence to justify: it is about reliability, not taste. If the primary is
 * down mid-launch, ads should fall back rather than silently stop rendering.
 *
 * Quality-based routing ("Higgsfield for cinematic video, fal for product
 * images") is deliberately NOT here. That rule requires knowing which engine is
 * actually better at what, and nobody has compared their output yet. See
 * 01-FOUNDING-DOCS/18-Render-Engine-Routing.md.
 */

import * as fal from "@/lib/fal/client";
import * as higgsfield from "@/lib/higgsfield/client";
import type { CreativeKind, RenderConceptInput, RenderStatus } from "@/lib/fal/client";

export type EngineName = "fal" | "higgsfield";

export interface RenderEngine {
  name: EngineName;
  /**
   * The exact model slug for a given kind, for the AI Act generation log.
   * The vendor name is not an answer to "which model produced this" — models
   * are swapped by env var, so the record has to name the one that actually ran.
   */
  modelFor: (kind: CreativeKind) => string;
  submit: (input: RenderConceptInput) => Promise<RenderStatus>;
  poll: (jobId: string, kind: CreativeKind) => Promise<RenderStatus>;
}

/** Build the fal engine, or null when it is not configured. */
export function falEngine(): RenderEngine | null {
  let cfg: fal.FalConfig;
  try {
    cfg = fal.falConfigFromEnv();
  } catch {
    return null;
  }
  return {
    name: "fal",
    modelFor: (kind) => fal.modelFor(cfg, kind),
    submit: (input) => fal.submitRender(cfg, input),
    poll: (jobId, kind) => fal.pollRender(cfg, jobId, kind),
  };
}

/** Build the Higgsfield standby, or null when it is not configured. */
export function higgsfieldEngine(): RenderEngine | null {
  let cfg: higgsfield.HiggsfieldConfig;
  try {
    cfg = higgsfield.higgsfieldConfigFromEnv();
  } catch {
    return null;
  }
  return {
    name: "higgsfield",
    // Higgsfield exposes no per-kind model slug; the vendor plus kind is the
    // most specific true answer available, and saying so beats inventing one.
    modelFor: (kind) => `higgsfield/${kind}`,
    submit: async (input) => higgsfield.submitRender(cfg, input),
    // Higgsfield polls by job id alone; the kind is irrelevant to its endpoint.
    poll: async (jobId) => higgsfield.pollRender(cfg, jobId),
  };
}

/**
 * Pure: order the available engines, primary first. Returns [] when nothing is
 * configured, which keeps the render lane dormant rather than throwing.
 */
export function availableEngines(
  primary: RenderEngine | null,
  standby: RenderEngine | null,
): RenderEngine[] {
  return [primary, standby].filter((e): e is RenderEngine => e !== null);
}

export interface FailoverResult {
  status: RenderStatus;
  engine: EngineName;
  /** Engines that threw before this one succeeded, for the journal. */
  failed: { engine: EngineName; error: string }[];
}

/**
 * Submit to the first engine that accepts the job.
 *
 * A *thrown* error means the engine is unreachable or misconfigured, so we try
 * the next one. A returned "failed" status is a real verdict about the content
 * (blocked as unsafe, bad prompt) and is NOT retried elsewhere: a second vendor
 * would reject it for the same reason, and retrying would just spend twice.
 */
export async function submitWithFailover(
  engines: readonly RenderEngine[],
  input: RenderConceptInput,
): Promise<FailoverResult | null> {
  const failed: { engine: EngineName; error: string }[] = [];
  for (const engine of engines) {
    try {
      const status = await engine.submit(input);
      return { status, engine: engine.name, failed };
    } catch (e) {
      failed.push({ engine: engine.name, error: (e as Error).message });
    }
  }
  return null; // every engine unreachable
}
