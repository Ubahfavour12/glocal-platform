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

export type Plan = "free" | "paid";

/** One free render on the free tier — the single taste of the product. */
export const FREE_RENDER_LIMIT = 1;

export interface PlanState {
  plan: Plan;
  /** whether the free tier's one render has been used up */
  freeRenderUsed: boolean;
}

/** Normalise a raw DB value into a Plan (defends against nulls / stray strings). */
export function asPlan(raw: string | null | undefined): Plan {
  return raw === "paid" ? "paid" : "free";
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
