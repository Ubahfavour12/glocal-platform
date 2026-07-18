/**
 * Champion fatigue detection — locked decision 2026-07-13.
 * The trigger is the DATA, not the calendar: a fixed N-day timer misfires at
 * both ends ($10/day champions aren't fatigued at day 5; $100/day ones fatigue
 * sooner). Signals, from the ad platform's own metrics:
 *
 *  - CTR decay: rolling-window CTR has fallen >25% from the champion's peak.
 *  - Frequency: average impressions per unique person reached exceeds 2.5.
 *  - Backstop: any reign reaching 10 days forces a refresh regardless.
 *
 * On trigger the champion is NOT dethroned (it earned the crown). Instead the
 * next challengers are forced style-divergent: new visual direction, new hook
 * archetype. The orchestrator passes that directive to the concept engine.
 */

export const CTR_DECAY_THRESHOLD = 0.25; // >25% below peak
export const FREQUENCY_THRESHOLD = 2.5; // avg views per person reached
export const MAX_REIGN_DAYS = 10; // hard backstop

export interface FatigueInput {
  /** When this creative became champion. */
  championSince: Date;
  /** Champion's best rolling-window CTR observed during its reign (from journal). */
  peakCtr: number;
  /** Current rolling-window CTR. */
  currentCtr: number;
  /** Current rolling-window impressions / unique reach; null when platform doesn't report reach. */
  frequency: number | null;
}

export type StyleDirective = "none" | "style_refresh";

export interface FatigueResult {
  directive: StyleDirective;
  reasons: string[];
}

export function checkFatigue(input: FatigueInput, now: Date): FatigueResult {
  const reasons: string[] = [];

  const reignDays = (now.getTime() - input.championSince.getTime()) / 86_400_000;
  if (reignDays >= MAX_REIGN_DAYS) {
    reasons.push(
      `champion has reigned ${Math.floor(reignDays)} days (backstop at ${MAX_REIGN_DAYS})`,
    );
  }

  if (input.peakCtr > 0 && input.currentCtr >= 0) {
    const decay = 1 - input.currentCtr / input.peakCtr;
    if (decay > CTR_DECAY_THRESHOLD) {
      reasons.push(
        `CTR has decayed ${(decay * 100).toFixed(0)}% from its peak (threshold ${CTR_DECAY_THRESHOLD * 100}%)`,
      );
    }
  }

  if (input.frequency !== null && input.frequency > FREQUENCY_THRESHOLD) {
    reasons.push(
      `audience frequency ${input.frequency.toFixed(1)} exceeds ${FREQUENCY_THRESHOLD} — the same people keep seeing it`,
    );
  }

  return { directive: reasons.length > 0 ? "style_refresh" : "none", reasons };
}

/** Track the peak CTR across a reign (call each nightly run; store in journal). */
export function updatePeakCtr(previousPeak: number, currentCtr: number): number {
  if (!Number.isFinite(currentCtr) || currentCtr < 0) return previousPeak;
  return Math.max(previousPeak, currentCtr);
}
