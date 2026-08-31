/**
 * Which engine renders which job.
 *
 * Both engines are live from the start, and the choice is made per job rather
 * than only when one of them falls over. The rules below are deliberately of
 * two different kinds, and it matters which is which:
 *
 *   Rule 1 (tier) is an economic fact. A free account gets one render, and a
 *   five-second video costs 10-40x an image, so an unpaid account never
 *   reaches the expensive engine. Nothing to measure here.
 *
 *   Rules 2 and 3 (kind) are a founder decision: Higgsfield for video because
 *   its strength is cinematic motion, fal for images because it is the cheap,
 *   fast, high-volume path. Nobody has compared their output on this product's
 *   own creatives yet, so these are assumptions, and they are recorded as
 *   assumptions rather than dressed up as measurements.
 *
 * What stops them staying assumptions forever: every render records the engine
 * that made it, so the duel that already decides which creative wins on money
 * becomes engine evidence for free. See `scoreboard.ts`. Routing only shifts on
 * that evidence once there is enough of it; flipping engines on three renders
 * would be worse than a fixed rule honestly labelled.
 *
 * Pure, so the whole policy is testable without a vendor or a database.
 */

import type { Plan } from "@/lib/billing/plan";
import type { CreativeKind } from "@/lib/fal/client";
import type { EngineName, RenderEngine } from "./engine";

export interface RouteInput {
  kind: CreativeKind;
  plan: Plan;
  /** Engines that are actually configured, in no particular order. */
  available: readonly RenderEngine[];
}

export interface Route {
  /** Try these in order. Empty when nothing is configured. */
  order: RenderEngine[];
  /** Why this order, in plain language, for the journal. */
  reason: string;
}

/** Preference order by name, before availability is considered. */
export function preferenceFor(kind: CreativeKind, plan: Plan): EngineName[] {
  // Tier beats kind on purpose: on a free account even a video stays on the
  // cheap engine, because the alternative is paying premium rates to render
  // for someone who has not paid anything.
  if (plan === "free") return ["fal"];
  return kind === "video" ? ["higgsfield", "fal"] : ["fal", "higgsfield"];
}

/**
 * Order the configured engines for this job.
 *
 * A preference is never allowed to stop a render: if the preferred engine is
 * not configured, whatever is left still gets the job, and the reason says so
 * rather than failing quietly. The one exception is the free tier, where the
 * restriction is the point and an unconfigured fal means no render at all.
 */
export function routeRender(input: RouteInput): Route {
  const byName = new Map(input.available.map((e) => [e.name, e]));
  const wanted = preferenceFor(input.kind, input.plan);
  const order = wanted.map((n) => byName.get(n)).filter((e): e is RenderEngine => !!e);

  if (input.plan === "free") {
    return {
      order,
      reason:
        order.length > 0
          ? "Free account, so this renders on fal where it costs least."
          : "Free account and fal is not configured, so there is nothing to render on.",
    };
  }

  // Paid: anything configured is better than refusing to render.
  const rest = input.available.filter((e) => !order.includes(e));
  const full = [...order, ...rest];

  if (full.length === 0) return { order: [], reason: "No render engine is configured." };

  const first = full[0].name;
  const expected = wanted[0];
  if (first !== expected) {
    return {
      order: full,
      reason: `${expected} is not configured, so this ${input.kind} renders on ${first} instead.`,
    };
  }
  return {
    order: full,
    reason:
      input.kind === "video"
        ? "Video goes to Higgsfield first for its motion work, with fal behind it."
        : "Images go to fal first, where they are cheapest and fastest.",
  };
}
