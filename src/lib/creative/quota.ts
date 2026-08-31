/**
 * Render quota — Phase 2, enforcing the pricing model (08-Pricing-Model).
 * Rendering is the real cost to serve, so it is metered in CODE, not trusted
 * to prompts: each subscription carries renders_per_day, and the agent may
 * never exceed it. Overage is available a la carte at a markup (Rule 2), so a
 * customer is never blocked from growing, only from silently overspending.
 *
 * Pure functions; the orchestrator counts today's renders and consults these.
 */

/**
 * What one video costs against the daily allowance, in image-renders.
 *
 * A five-second video costs roughly 10-40x an image at the vendors. At the
 * advertised caps, letting a video spend one credit like an image does would
 * put render cost at about half of a $39 subscription before a single support
 * message is answered, and worse, the customer on the minimum ad budget who
 * renders video daily generates almost no markup to offset it.
 *
 * Four is deliberately below the true cost ratio. The point is not to recover
 * the difference, it is to stop the cheapest customer being the most expensive
 * one, while leaving the choice genuinely free.
 */
export const VIDEO_CREDIT_WEIGHT = 4;

export type RenderKind = "image" | "video";

/** How much of the daily allowance one render of this kind consumes. */
export function creditsFor(kind: RenderKind): number {
  return kind === "video" ? VIDEO_CREDIT_WEIGHT : 1;
}

export interface QuotaState {
  /** renders already produced for this business today */
  usedToday: number;
  /** the subscription's renders_per_day */
  dailyLimit: number;
}

export function remainingRenders(q: QuotaState): number {
  return Math.max(0, q.dailyLimit - q.usedToday);
}

export function canRender(q: QuotaState): boolean {
  return remainingRenders(q) > 0;
}

/**
 * Whether this kind fits in what is left today.
 *
 * Asked before a video is offered, so the customer is told it will not fit
 * rather than picking it and watching it fail.
 */
export function canRenderKind(q: QuotaState, kind: RenderKind): boolean {
  return remainingRenders(q) >= creditsFor(kind);
}

/** Renders of this kind still affordable today. */
export function remainingOfKind(q: QuotaState, kind: RenderKind): number {
  return Math.floor(remainingRenders(q) / creditsFor(kind));
}

/**
 * How many of `wanted` renders fit in today's quota, and how many would be
 * paid overage. The agent renders the in-quota ones for free and can offer
 * the overage as a paid top-up rather than dropping the work.
 */
export function splitAgainstQuota(
  q: QuotaState,
  wanted: number,
): { withinQuota: number; overage: number } {
  const free = Math.min(wanted, remainingRenders(q));
  return { withinQuota: free, overage: Math.max(0, wanted - free) };
}

/** Overage price in USD minor units at the à-la-carte markup (default 2x cost). */
export function overageCostUsdMinor(
  overageCount: number,
  unitCostUsdMinor: number,
  markupMultiplier = 2,
): number {
  if (overageCount <= 0) return 0;
  return Math.ceil(overageCount * unitCostUsdMinor * markupMultiplier);
}
