/**
 * Marking-consistency gate — loophole fix locked 2026-07-21.
 *
 * Manual (mark-as-sold) and pixel revenue may be judged in a duel ONLY when
 * the seller's marking is consistent across the verdict window. A seller who
 * marks sales sporadically produces BIASED revenue data (only the days they
 * remembered), and a biased ROAS is worse than no ROAS: the duel would crown
 * whichever ad happened to run on a remembered day. Store-connected revenue
 * is exempt — it arrives automatically and cannot be forgotten.
 *
 * Gate: within the rolling verdict window, at least MIN_ATTRIBUTED_ORDERS
 * attributed sales spread across at least MIN_ACTIVE_DAYS distinct days.
 * When the gate is closed, the duel judges on CPCI and marked sales still
 * feed totals and preference learning — degradation, never distortion.
 */

import { WINDOW_DAYS } from "@/lib/verdicts/verdict";
import type { AttributedOrder } from "./attribution";

export const MIN_ATTRIBUTED_ORDERS = 3;
export const MIN_ACTIVE_DAYS = 2;

export interface ConsistencyResult {
  allowed: boolean;
  attributedOrders: number;
  activeDays: number;
  reason: string;
}

/** May manually-reported revenue judge the duel for this window? */
export function revenueJudgingAllowed(
  orders: readonly AttributedOrder[],
  now: Date,
): ConsistencyResult {
  const cutoff = now.getTime() - WINDOW_DAYS * 86_400_000;
  const inWindow = orders.filter(
    (o) => o.code !== null && o.at.getTime() >= cutoff && o.at.getTime() <= now.getTime(),
  );
  const days = new Set(inWindow.map((o) => o.at.toISOString().slice(0, 10)));

  const enoughOrders = inWindow.length >= MIN_ATTRIBUTED_ORDERS;
  const enoughDays = days.size >= MIN_ACTIVE_DAYS;
  const allowed = enoughOrders && enoughDays;

  let reason: string;
  if (allowed) {
    reason = `${inWindow.length} attributed sales across ${days.size} days — revenue judging on`;
  } else if (!enoughOrders) {
    reason = `only ${inWindow.length} attributed sales in the window (need ${MIN_ATTRIBUTED_ORDERS}) — judging on cost per conversation instead`;
  } else {
    reason = `all sales marked on a single day — need activity across ${MIN_ACTIVE_DAYS}+ days before revenue can judge`;
  }
  return { allowed, attributedOrders: inWindow.length, activeDays: days.size, reason };
}
