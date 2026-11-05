/**
 * Freemium plan gating (Phase 4 prep, DECIDED 26 Jul). Pure, fixture-tested.
 *
 * The model: FREE gets onboarding + the agent's concepts + exactly ONE render
 * (the "wow"), then must upgrade. PAID unlocks video renders, rendering at
 * volume, and actually launching ads. This is where the subscription + markup
 * profit lives. Dormant until Higgsfield (the render it gates) and Phase-4
 * payments (the upgrade) are connected — but the rules live here now so the
 * whole app gates consistently.
 */

import { isTierId, type TierId } from "./subscription";

export type Plan = "free" | "paid";

/**
 * The tier, kept whole, for decisions that need to tell paid tiers apart.
 *
 * `Plan` deliberately collapses every paid tier into "paid", which is right for
 * the render *permission* gate — a paying customer may render, and which tier
 * they are on does not change that. It is wrong for anything that differs
 * between tiers, and render-engine routing is now one of those things, so that
 * question gets its own type rather than widening `Plan` and making every
 * caller of `asPlan` think about tiers it does not care about.
 */
export type RenderTier = "free" | TierId;

/** One free render on the free tier — the single taste of the product. */
export const FREE_RENDER_LIMIT = 1;

export interface PlanState {
  plan: Plan;
  /** whether the free tier's one render has been used up */
  freeRenderUsed: boolean;
}

/**
 * Normalise a raw DB value into the free/paid render-gate. Any non-free plan
 * (the tiers "starter"/"growth"/"scale", or a bare "paid") counts as paid; the
 * specific tier is read separately where pricing/features matter.
 */
export function asPlan(raw: string | null | undefined): Plan {
  return raw && raw !== "free" ? "paid" : "free";
}

/**
 * Normalise a raw `businesses.plan` value into a tier.
 *
 * `activateSubscription` writes the tier id straight into `businesses.plan`, so
 * the value is normally "starter", "growth" or "scale". A paid-but-unrecognised
 * value — a legacy bare "paid", or a tier added to the pricing page before this
 * table — resolves to the LOWEST paid tier. That direction is deliberate: it
 * errs toward the cheaper engine, so a value nobody has mapped yet cannot
 * quietly start spending the expensive vendor's credits.
 */
export function asTier(raw: string | null | undefined): RenderTier {
  if (!raw || raw === "free") return "free";
  return isTierId(raw) ? raw : "starter";
}

export function isPaid(s: PlanState): boolean {
  return s.plan === "paid";
}

/** How many renders this business may still produce. Paid = unlimited. */
export function rendersRemaining(s: PlanState): number {
  if (s.plan === "paid") return Number.POSITIVE_INFINITY;
  return s.freeRenderUsed ? 0 : FREE_RENDER_LIMIT;
}

/** Can the render lane produce a creative for this business right now? */
export function planAllowsRender(s: PlanState): boolean {
  return rendersRemaining(s) > 0;
}

/**
 * Launching ads is a paid-only capability — the free render is a preview, not a
 * live campaign. (A funded wallet is still separately required.)
 */
export function planAllowsLaunch(s: PlanState): boolean {
  return s.plan === "paid";
}

export type Gate = "ok" | "needs_upgrade_render" | "needs_upgrade_launch";

/** Why an action is blocked (drives the paywall copy). */
export function renderGate(s: PlanState): Gate {
  return planAllowsRender(s) ? "ok" : "needs_upgrade_render";
}

export function launchGate(s: PlanState): Gate {
  return planAllowsLaunch(s) ? "ok" : "needs_upgrade_launch";
}

/** Plain-language line for the paywall / plan card. */
export function planSummary(s: PlanState): string {
  if (s.plan === "paid") return "You're on the full plan. Renders and ad launches are unlimited.";
  if (!s.freeRenderUsed) {
    return "Free preview: the agent will render one ad from your product photo. Upgrade any time for video, more renders, and live ads.";
  }
  return "You've used your free preview render. Upgrade to unlock video, unlimited renders, and launching real ads.";
}
