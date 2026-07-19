/**
 * Post-rejection catch & quarantine loop — Blueprint §6.2, PRD F-13.
 * When an ad network reports DISAPPROVED, classify the reason, decide the
 * action, and enforce the Trust Score. Pure logic; the webhook route and DB
 * writes wrap this. Every real rejection code also feeds the gateway's
 * knowledge (hardening loop) — handled by the caller.
 */

export type RejectionTier = "soft" | "hard";
export type RejectionAction = "auto_fix" | "quarantine";

/**
 * Tier 1 SOFT = technical/formatting, auto-fixable (regenerate & resubmit).
 * Tier 2 HARD = policy/legal, quarantine the customer profile.
 * Codes below are representative Meta reason patterns; extended from real
 * rejections over time.
 */
const SOFT_PATTERNS: RegExp[] = [
  /text.?overlay/i,
  /image.?quality|low.?resolution|blurr?y/i,
  /aspect.?ratio|dimensions?/i,
  /capitaliz|grammar|punctuation/i,
  /broken.?link|landing.?page.?unavailable|url/i,
  /non.?functional/i,
];

const HARD_PATTERNS: RegExp[] = [
  /circumvent|system.?circumvention/i,
  /personal.?attribut|personal.?health/i,
  /prohibited|restricted.?content/i,
  /misleading|deceptive|unrealistic|exaggerat/i,
  /counterfeit|intellectual.?property/i,
  /adult|sexual|nudity/i,
  /hate|violence|weapon|drug/i,
  /medical|health.?claim|before.?after/i,
  /financial.?product|crypto|gambling/i,
];

export function classifyRejection(reason: string): RejectionTier {
  const r = reason ?? "";
  // Hard takes precedence: a policy violation is never "just formatting".
  if (HARD_PATTERNS.some((p) => p.test(r))) return "hard";
  if (SOFT_PATTERNS.some((p) => p.test(r))) return "soft";
  // Unknown reasons are treated as HARD by default: fail safe, protect the
  // master account rather than blindly auto-resubmitting an unknown risk.
  return "hard";
}

export function actionForTier(tier: RejectionTier): RejectionAction {
  return tier === "soft" ? "auto_fix" : "quarantine";
}

// ---------- Trust Score: 3 hard strikes in a rolling 30 days = frozen ----------

export const STRIKE_WINDOW_DAYS = 30;
export const STRIKE_LIMIT = 3;

export interface Strike {
  at: Date;
  tier: RejectionTier;
}

/** Count hard strikes within the rolling window ending at `now`. */
export function hardStrikesInWindow(strikes: readonly Strike[], now: Date): number {
  const cutoff = now.getTime() - STRIKE_WINDOW_DAYS * 86_400_000;
  return strikes.filter((s) => s.tier === "hard" && s.at.getTime() >= cutoff).length;
}

/** Is the customer's publishing frozen (strike limit reached)? */
export function isFrozen(strikes: readonly Strike[], now: Date): boolean {
  return hardStrikesInWindow(strikes, now) >= STRIKE_LIMIT;
}

export interface RejectionOutcome {
  tier: RejectionTier;
  action: RejectionAction;
  /** hard strikes counted after this rejection is applied */
  strikeCount: number;
  frozen: boolean;
  /** plain-language line for the customer / audit log */
  message: string;
}

/**
 * Full decision for one incoming rejection. `priorStrikes` are the customer's
 * existing strikes; this rejection is included in the count when it is hard.
 */
export function handleRejection(
  reason: string,
  priorStrikes: readonly Strike[],
  now: Date,
): RejectionOutcome {
  const tier = classifyRejection(reason);
  const action = actionForTier(tier);
  const all = tier === "hard" ? [...priorStrikes, { at: now, tier }] : [...priorStrikes];
  const strikeCount = hardStrikesInWindow(all, now);
  const frozen = strikeCount >= STRIKE_LIMIT;

  let message: string;
  if (tier === "soft") {
    message = "I paused that ad and I'm fixing a technical issue, then resubmitting. No action needed from you.";
  } else if (frozen) {
    message = `That ad broke a platform policy. This is strike ${strikeCount} in 30 days, so publishing is frozen while we review. Please contact support.`;
  } else {
    message = `That ad broke a platform policy and was paused. Strike ${strikeCount} of ${STRIKE_LIMIT} in a rolling 30 days.`;
  }
  return { tier, action, strikeCount, frozen, message };
}
