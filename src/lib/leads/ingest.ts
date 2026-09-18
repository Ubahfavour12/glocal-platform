/**
 * Fetch a Meta lead, keep almost none of it, and record where it came from.
 *
 * The webhook only says "a lead exists, here is its id". The answers must be
 * fetched from the Graph API — and the moment you fetch them you are holding a
 * member of the public's name, phone number and email.
 *
 * That record passes through this function and does not survive it. What is
 * written down is a recognition label and the ad that produced the lead. The
 * contact itself stays where it already is: Meta's lead centre, and the
 * owner's phone. See `capture.ts` for why that boundary is drawn there.
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
import { log } from "@/lib/log";
import { deriveLabel, dedupeKey, type LeadField, type LeadgenEvent } from "./capture";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Ask Meta for the answers, and return only a label.
 *
 * The full field list never leaves this function — not returned, not logged,
 * not passed on. A failure returns null rather than throwing: a lead we cannot
 * label is still a lead worth recording, and losing the attribution because a
 * name lookup timed out would be a poor trade.
 */
export async function fetchLabel(
  leadgenId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${GRAPH}/${encodeURIComponent(leadgenId)}?fields=field_data`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { field_data?: LeadField[] };
    return deriveLabel(body.field_data ?? []);
  } catch {
    // Deliberately no detail in the log. An error body from this endpoint can
    // echo the very field values we are refusing to store.
    log.warn("lead.label_unavailable", { leadgenId });
    return null;
  }
}

export interface LeadInsert {
  business_id: string;
  ad_id: string | null;
  creative_id: string | null;
  source: "meta_form";
  label: string;
  external_ref: string;
  created_at: string;
}

/**
 * Build the row to insert.
 *
 * Pure, so the decision about what gets written is testable without a network
 * or a database — which matters more here than usual, because the thing being
 * decided is how much personal data we keep.
 */
export function toLeadRow(
  event: LeadgenEvent,
  businessId: string,
  ad: { id: string; creative_id: string | null } | null,
  label: string | null,
): LeadInsert {
  return {
    business_id: businessId,
    ad_id: ad?.id ?? null,
    creative_id: ad?.creative_id ?? null,
    source: "meta_form",
    // "Lead" rather than an empty label: a blank row in the weekly review is
    // worse than an unhelpful one, because the owner still has to be able to
    // mark it won or lost.
    label: label ?? "Lead",
    external_ref: dedupeKey(event),
    created_at: event.createdAt.toISOString(),
  };
}
