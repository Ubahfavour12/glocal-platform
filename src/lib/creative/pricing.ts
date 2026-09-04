/**
 * What a render costs us, recorded on every creative.
 *
 * Neither vendor returns a charge on the queue result, so this cannot be a
 * measurement of what was actually billed. It is a **configured rate**, and the
 * distinction matters enough to say out loud: these numbers are the best
 * estimates available today, not invoices.
 *
 * The point of writing them down anyway is that an estimate in a codebase can
 * be corrected once, from the real invoice, and every figure that depends on it
 * moves with it. An estimate in a conversation cannot. Until now the whole
 * argument about video economics, the "10-40x an image" figure and the
 * VIDEO_CREDIT_WEIGHT that came out of it, lived only in a chat message.
 *
 * Override any of these with env vars when the real bill arrives, without a
 * deploy of new code:
 *   RENDER_PRICE_FAL_IMAGE_USD_MINOR, RENDER_PRICE_FAL_VIDEO_USD_MINOR,
 *   RENDER_PRICE_HIGGSFIELD_IMAGE_USD_MINOR, ..._VIDEO_USD_MINOR
 */

import type { EngineName } from "./engine";
import type { RenderKind } from "./quota";

/** Configured rates in USD minor units. Deliberately conservative (high). */
const DEFAULT_PRICE: Record<EngineName, Record<RenderKind, number>> = {
  // Flux-class image, and a Kling-class 5s clip.
  fal: { image: 3, video: 40 },
  // Higgsfield bills by subscription rather than per generation, so a
  // per-render figure is an allocation, not a price. Held at the same order as
  // fal video until a real bill says otherwise.
  higgsfield: { image: 5, video: 45 },
};

function envOverride(engine: EngineName, kind: RenderKind): number | null {
  const key = `RENDER_PRICE_${engine.toUpperCase()}_${kind.toUpperCase()}_USD_MINOR`;
  const raw = process.env[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * The rate to record for one render.
 *
 * Never throws and never returns a negative: an unknown engine falls back to
 * the dearer of the two, because under-recording cost is the failure that
 * hurts. A missing figure would silently flatter the margin.
 */
export function renderCostUsdMinor(engine: string, kind: RenderKind): number {
  const e = (engine === "higgsfield" ? "higgsfield" : "fal") as EngineName;
  const override = envOverride(e, kind);
  if (override !== null) return override;
  return DEFAULT_PRICE[e][kind];
}

/** What a month of daily renders at this mix would cost, for the tier maths. */
export function monthlyRenderCostUsdMinor(
  engine: string,
  kind: RenderKind,
  perDay: number,
  days = 30,
): number {
  if (!(perDay > 0)) return 0;
  return Math.round(renderCostUsdMinor(engine, kind) * perDay * days);
}
