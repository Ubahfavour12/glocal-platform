/**
 * "Meta counted seven. You logged two."
 *
 * Some lead channels cannot be captured automatically yet — a WhatsApp
 * conversation needs the Cloud API, which needs a verified business and a
 * domain. Until then those leads only exist if somebody types them in, and the
 * dangerous part is not the typing: it is that a MISSED lead is invisible.
 * Cost-per-won quietly gets better for the ad whose leads went unlogged, and
 * nothing anywhere says so.
 *
 * Meta already counts messaging conversations started from each ad. We cannot
 * see who they were — that is the whole reason the Cloud API exists — but we
 * can see HOW MANY, and compare. That turns an invisible gap into a specific,
 * checkable sentence naming the ad.
 *
 * Deliberately a PROMPT, not a correction. Inventing placeholder leads to make
 * the numbers agree would be fabricating evidence about which ad produces
 * business, and the whole point of this work is that the product does not
 * claim more than it knows.
 */

export interface AdLeadCounts {
  adId: string;
  /** Conversations Meta says this ad started. */
  reportedByMeta: number;
  /** Leads actually recorded against it, however they arrived. */
  logged: number;
}

export interface LeadGap {
  adId: string;
  missing: number;
  reportedByMeta: number;
  logged: number;
}

/**
 * How many leads are unaccounted for, per ad.
 *
 * Only counts SHORTFALLS. Logging more than Meta reports is normal and not a
 * problem: walk-ins, referrals and repeat customers are real leads that never
 * touched an ad, and flagging them would train people to ignore this.
 *
 * The threshold exists because Meta's attribution window and ours never align
 * to the hour, so a difference of one is noise at any volume. Reporting it
 * would produce a permanent, slightly-wrong warning, which is the fastest way
 * to make a warning worthless.
 */
export function leadGaps(counts: AdLeadCounts[], minGap = 2): LeadGap[] {
  return counts
    .map((c) => ({
      adId: c.adId,
      missing: c.reportedByMeta - c.logged,
      reportedByMeta: c.reportedByMeta,
      logged: c.logged,
    }))
    .filter((g) => g.missing >= minGap)
    .sort((a, b) => b.missing - a.missing);
}

/**
 * The sentence the owner sees, or nothing.
 *
 * Names the number and no more. It does not say "you forgot" — the likeliest
 * explanation is that WhatsApp conversations cannot be captured automatically
 * yet, which is our limitation and not theirs.
 */
export function gapMessage(gaps: LeadGap[]): string | null {
  if (gaps.length === 0) return null;
  const total = gaps.reduce((s, g) => s + g.missing, 0);
  const ads = gaps.length;
  return `Meta counted ${total} more ${total === 1 ? "conversation" : "conversations"} from ${
    ads === 1 ? "one of your ads" : `${ads} of your ads`
  } than there are leads logged here. Adding them keeps the "which ad brought business" answer honest.`;
}

/** Meta action types that mean "somebody started a conversation from this ad". */
export const MESSAGING_ACTIONS = new Set([
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
]);

/**
 * Pull the conversation count out of an insights row's actions.
 *
 * Meta reports several overlapping messaging metrics for the same event, so
 * summing them double-counts. The LARGEST is taken instead: these are
 * different windows over the same conversations, not separate ones, and
 * over-reporting a gap would send someone hunting for leads that never existed.
 */
export function messagingConversations(
  actions: { action_type: string; value: string }[] | undefined,
): number {
  if (!actions) return 0;
  let max = 0;
  for (const a of actions) {
    if (!MESSAGING_ACTIONS.has(a.action_type)) continue;
    const n = Number(a.value || 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
