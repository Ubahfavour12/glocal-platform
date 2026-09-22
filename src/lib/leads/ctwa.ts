/**
 * WhatsApp lead attribution the customer cannot tamper with.
 *
 * THE PROBLEM WITH THE PREFILL. A wa.me link can pre-fill a message, and ours
 * carries "(ref GL-7K4)" so a seller can tell which ad produced an enquiry.
 * That text sits in the sender's compose box and is fully editable. Anyone can
 * delete the code before sending — plenty will, because it reads like clutter —
 * and some will edit it. So the prefill is a HINT, not evidence: it can be
 * missing, and it can be wrong, and neither is detectable afterwards.
 *
 * THE FIX. A Click-to-WhatsApp ad makes Meta mint a click id at the moment of
 * the tap. When that person sends their first message, Meta attaches a
 * `referral` object to the INBOUND MESSAGE WEBHOOK carrying `ctwa_clid` and
 * `source_id` (the ad). It travels server-to-server, out of reach of the
 * sender's keyboard. They can delete every word of the message and the
 * attribution still arrives.
 *
 * So the two paths are not alternatives, they are ranked. `ctwa` is evidence.
 * `prefill` is a hint. `manual` is a human's word. The lead records which it
 * had, because a cost-per-won built on hints should not be presented with the
 * same confidence as one built on Meta's own click ids.
 */

export type AttributionSource = "ctwa" | "prefill" | "manual";

/** A first inbound message that came from an ad. */
export interface CtwaLead {
  /** WhatsApp's id for the sender. A phone number — never stored as-is. */
  waId: string;
  /** Their WhatsApp profile name, if they have one set. */
  profileName: string | null;
  /** Meta's click id. Unique per ad tap, and our dedupe key. */
  ctwaClid: string;
  /** The ad that was tapped, as Meta's own ad id. */
  platformAdId: string | null;
  /** The business's own WhatsApp number that was messaged. */
  toPhoneNumberId: string | null;
  receivedAt: Date;
}

/**
 * Pull ad-referred conversations out of a WhatsApp Cloud API webhook.
 *
 * Only messages carrying a `referral` are leads. Every other inbound message is
 * an ordinary conversation — a regular customer, a supplier, a wrong number —
 * and turning those into leads would fill the pipeline with people who never
 * saw an ad, which is the same mistake as counting a link tap as a lead.
 *
 * Meta sends the referral on the FIRST message of the conversation only. A
 * follow-up in the same thread has none, so a second message must not create a
 * second lead.
 */
export function parseCtwaLeads(payload: unknown): CtwaLead[] {
  const out: CtwaLead[] = [];
  if (typeof payload !== "object" || payload === null) return out;

  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const c = change as { field?: unknown; value?: unknown };
      if (c.field !== "messages") continue;

      const v = c.value as
        | {
            metadata?: { phone_number_id?: unknown };
            contacts?: { wa_id?: unknown; profile?: { name?: unknown } }[];
            messages?: {
              from?: unknown;
              timestamp?: unknown;
              referral?: { source_id?: unknown; ctwa_clid?: unknown; source_type?: unknown };
            }[];
          }
        | undefined;

      const messages = v?.messages;
      if (!Array.isArray(messages)) continue;

      const phoneNumberId =
        typeof v?.metadata?.phone_number_id === "string" ? v.metadata.phone_number_id : null;

      for (const m of messages) {
        const ref = m.referral;
        const ctwaClid = typeof ref?.ctwa_clid === "string" ? ref.ctwa_clid : null;
        // No click id, no evidence. An ordinary message, not a lead.
        if (!ctwaClid) continue;

        const from = typeof m.from === "string" ? m.from : null;
        if (!from) continue;

        // Meta sends unix SECONDS as a string here. Treating it as milliseconds
        // dates every lead to 1970 and empties "leads this week" silently.
        const ts = Number(m.timestamp);
        const receivedAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();

        const contact = (v?.contacts ?? []).find((x) => x?.wa_id === from);
        const profileName =
          typeof contact?.profile?.name === "string" ? contact.profile.name : null;

        out.push({
          waId: from,
          profileName,
          ctwaClid,
          platformAdId: typeof ref?.source_id === "string" ? ref.source_id : null,
          toPhoneNumberId: phoneNumberId,
          receivedAt,
        });
      }
    }
  }
  return out;
}

/**
 * A recognition label, under the same rule as Meta lead forms.
 *
 * The inbound webhook hands us a full phone number and a profile name. We keep
 * a first name and four digits, because that is what a seller needs to know
 * which chat this is, and anything more makes us a database of other people's
 * contact details for no gain — they already have the conversation open.
 */
export function ctwaLabel(lead: CtwaLead): string {
  const first = (lead.profileName ?? "").trim().split(/\s+/)[0] ?? "";
  const tail = lead.waId.replace(/\D+/g, "").slice(-4);
  if (first && tail) return `${first} ••${tail}`;
  if (first) return first;
  if (tail) return `••${tail}`;
  return "WhatsApp lead";
}

/**
 * Meta's click id is already unique per tap, so it is the dedupe key.
 *
 * Namespaced separately from `meta:` lead forms: the two arrive on different
 * webhooks and there is no reason to assume their id spaces never collide.
 */
export function ctwaDedupeKey(lead: CtwaLead): string {
  return `ctwa:${lead.ctwaClid}`;
}
