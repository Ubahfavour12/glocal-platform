/**
 * Which engine renders which job.
 *
 * The engine that gets paid for does the work. `preferredPrimary()` in
 * engine.ts names it — Higgsfield since 5 Nov 2026 — and this module orders
 * every job primary-first, with the other engine behind it as failover.
 *
 * This replaced a split by kind ("Higgsfield for cinematic video, fal for
 * cheap images"). That rule was recorded in its own header as an untested
 * assumption, and it had a consequence nobody had traced: the first render on
 * every account is always an image, so an image rule is in practice the rule
 * for first contact with a new business. While both engines were configured it
 * sent every one of those to fal, which meant a paid Higgsfield subscription
 * could sit untouched and look broken. An assumption is not worth that, so the
 * paid-for engine leads and output gets compared on real duels instead.
 *
 * One rule here is an economic fact rather than a preference: a free account
 * gets one render and no failover shopping, because a 5-second video costs
 * 10-40x an image and an unpaid account has not paid for either. It is now
 * expressed as "the primary, and only the primary" rather than "fal", because
 * naming a vendor made the restriction collapse the moment that vendor was the
 * one removed — see the note in routeRender.
 *
 * What stops the primary-first choice being an assumption forever: every
 * render records the engine that made it, so the duel that already decides
 * which creative wins on money becomes engine evidence for free. See
 * `scoreboard.ts`. Routing only shifts on that evidence once there is enough of
 * it; flipping engines on three renders would be worse than a fixed rule
 * honestly labelled.
 *
 * Pure, so the whole policy is testable without a vendor or a database.
 */

import type { Plan } from "@/lib/billing/plan";
import type { CreativeKind } from "@/lib/fal/client";
import { preferredPrimary, standbyFor, type EngineName, type RenderEngine } from "./engine";

export interface RouteInput {
  kind: CreativeKind;
  plan: Plan;
  /** Engines that are actually configured, in no particular order. */
  available: readonly RenderEngine[];
  /** Which engine leads; defaults to the configured primary. */
  primary?: EngineName;
}

export interface Route {
  /** Try these in order. Empty when nothing is configured. */
  order: RenderEngine[];
  /** Why this order, in plain language, for the journal. */
  reason: string;
}

/**
 * Preference order by name, before availability is considered.
 *
 * `kind` no longer changes the order — it is kept because it belongs to the
 * question being asked, and because the reason strings still name it.
 */
export function preferenceFor(
  kind: CreativeKind,
  plan: Plan,
  primary: EngineName = preferredPrimary(),
): EngineName[] {
  void kind;
  // Free: the primary alone. No failover, so one unpaid render cannot become
  // two attempts across two vendors.
  if (plan === "free") return [primary];
  return [primary, standbyFor(primary)];
}

/**
 * Order the configured engines for this job.
 *
 * A preference is never allowed to stop a render: if the preferred engine is
 * not configured, whatever is left still gets the job, and the reason says so
 * rather than failing quietly.
 *
 * That now holds for the free tier too, which is a deliberate change. The old
 * version returned nothing for a free account when fal specifically was
 * missing, and that was silently untrue: the caller falls back to the full
 * engine list when the route is empty, so the render happened anyway, on the
 * engine the journal had just finished saying was off limits. Two ways out
 * existed — make the refusal real, or stop refusing. Refusing for real would
 * have killed the free preview outright the moment fal was replaced, and the
 * free preview is the product's entire first impression. So the restriction
 * keeps the part that costs money (one engine, one render, no failover) and
 * drops the part that only named a vendor.
 */
export function routeRender(input: RouteInput): Route {
  const primary = input.primary ?? preferredPrimary();
  const byName = new Map(input.available.map((e) => [e.name, e]));
  const wanted = preferenceFor(input.kind, input.plan, primary);
  const order = wanted.map((n) => byName.get(n)).filter((e): e is RenderEngine => !!e);

  if (input.plan === "free") {
    if (order.length > 0) {
      return {
        order,
        reason: `Free account, so this ${input.kind} renders on ${order[0].name} alone, with no failover.`,
      };
    }
    // The primary is not configured. Render on what there is rather than
    // refusing — but still only one engine, which is what the tier restricts.
    const only = input.available[0];
    return only
      ? {
          order: [only],
          reason: `Free account and ${primary} is not configured, so this ${input.kind} renders on ${only.name} alone instead.`,
        }
      : { order: [], reason: "No render engine is configured." };
  }

  // Paid: anything configured is better than refusing to render.
  const rest = input.available.filter((e) => !order.includes(e));
  const full = [...order, ...rest];

  if (full.length === 0) return { order: [], reason: "No render engine is configured." };

  const first = full[0].name;
  if (first !== primary) {
    return {
      order: full,
      reason: `${primary} is not configured, so this ${input.kind} renders on ${first} instead.`,
    };
  }
  return {
    order: full,
    reason:
      full.length > 1
        ? `This ${input.kind} renders on ${primary}, with ${full[1].name} behind it as failover.`
        : `This ${input.kind} renders on ${primary}, the only engine configured.`,
  };
}
