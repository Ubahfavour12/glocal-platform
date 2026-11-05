/**
 * Render engine selection + failover.
 *
 * HIGGSFIELD IS PRIMARY, fal is the standby. Changed 5 Nov 2026 when the
 * founder subscribed to Higgsfield: it is the engine being paid for, so it is
 * the engine that should do the work, and fal exists to catch a failure rather
 * than to be the default.
 *
 * Failover itself needs no evidence to justify — it is about reliability, not
 * taste. If the primary is down mid-launch, ads should fail over rather than
 * silently stop rendering.
 *
 * Quality-based routing ("Higgsfield for cinematic video, fal for product
 * images") used to live in router.ts and has been removed, not moved here. It
 * required knowing which engine is better at what, nobody had compared their
 * output, and its image half silently kept every first render away from the
 * engine being paid for. See 01-FOUNDING-DOCS/18-Render-Engine-Routing.md.
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

/** Which engine leads. Default reflects the subscription being paid for. */
export const DEFAULT_PRIMARY: EngineName = "higgsfield";

/** Pure: the other engine. Two vendors, so this is total, not a lookup. */
export function standbyFor(primary: EngineName): EngineName {
  return primary === "fal" ? "higgsfield" : "fal";
}

/**
 * Pure: read the preferred primary from configuration.
 *
 * Config is allowed to decide this, unlike the payment rail, and the
 * difference is worth stating because that distinction was learned the hard
 * way here. `PAYMENTS_PROVIDER` could once route real customer money to a
 * retired processor, so that setting is now ignored by code. Choosing a render
 * engine cannot lose anyone's money: the worst an incorrect value can do is
 * fall through to the default, and the worst a wrong-but-valid one can do is
 * render on the other paid engine. So this stays switchable without a deploy,
 * which is exactly what you want while comparing two engines' output.
 */
export function preferredPrimary(
  raw = process.env.RENDER_PRIMARY,
): EngineName {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "fal" || value === "higgsfield" ? value : DEFAULT_PRIMARY;
}

/**
 * Order the two engines by preference, primary first.
 *
 * Takes both engines and decides, rather than making every caller remember
 * which argument position means "primary" — the previous arrangement, where
 * priority was argument order alone, is how fal stayed primary silently after
 * the decision to pay for Higgsfield.
 */
export function orderedEngines(
  fal: RenderEngine | null,
  higgsfield: RenderEngine | null,
  primary: EngineName = preferredPrimary(),
): RenderEngine[] {
  return primary === "fal"
    ? availableEngines(fal, higgsfield)
    : availableEngines(higgsfield, fal);
}

/**
 * Engines in order for a job, honouring the tier restriction.
 *
 * This exists so one function answers "what does this job run on", instead of
 * the ordering here being quietly overruled by the per-job router downstream —
 * which is exactly what happened to the last engine decision. `router.ts`
 * decides; the fallback to the plain configured order only covers the case
 * where it has nothing to say.
 */
export function enginesForJob(
  engines: readonly RenderEngine[],
  route: { order: RenderEngine[] },
): RenderEngine[] {
  return route.order.length > 0 ? route.order : [...engines];
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
