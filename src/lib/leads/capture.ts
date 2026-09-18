/**
 * Turning a Meta lead-form submission into a lead we can measure — without
 * becoming a database of our customers' customers.
 *
 * Meta's webhook does not carry the answers. It carries a `leadgen_id` and
 * says "come and fetch it". When you fetch it you get a name, a phone number
 * and an email: the full contact details of a member of the public who has
 * never heard of Glocal.
 *
 * WE DO NOT STORE THAT. Holding it would cross the NDPA's 200-data-subject
 * threshold on the first day of real ad spend, pull in the matching GDPR
 * duties, and turn any future breach from "our customers' business data" into
 * "our customers' customers' phone numbers" — all to duplicate a contact the
 * business already has sitting in WhatsApp.
 *
 * So the details are fetched, reduced to a RECOGNITION LABEL, and dropped.
 * "Ada ••7391" is enough for an owner to know which lead they are tapping in
 * the weekly review, and identifies nobody to anybody else. The full record
 * stays where it already lives: Meta's own lead centre, and the owner's phone.
 *
 * Everything here is pure. The fetching lives in the route; this decides what
 * a lead IS and what we keep of it, which is the part that has to be right.
 */

/** What Meta's webhook gives us, per lead. */
export interface LeadgenEvent {
  leadgenId: string;
  formId: string | null;
  /** Meta's ad id, which we map to our own ad row. Null on organic forms. */
  platformAdId: string | null;
  createdAt: Date;
}

/** One answer from the lead form, as Meta returns it. */
export interface LeadField {
  name: string;
  values: string[];
}

/**
 * Pull lead events out of a webhook payload.
 *
 * The same endpoint receives ad-review events, so this must ignore everything
 * that is not `leadgen` rather than assuming the payload shape. Meta batches
 * entries, and a malformed entry among good ones must not lose the good ones —
 * a thrown parse here would drop a customer's real lead on the floor.
 */
export function parseLeadgenEvents(payload: unknown): LeadgenEvent[] {
  const out: LeadgenEvent[] = [];
  if (typeof payload !== "object" || payload === null) return out;

  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const c = change as { field?: unknown; value?: unknown };
      if (c.field !== "leadgen") continue;
      const v = c.value as Record<string, unknown> | undefined;
      const leadgenId = typeof v?.leadgen_id === "string" ? v.leadgen_id : null;
      if (!leadgenId) continue;

      // Meta sends seconds; JavaScript wants milliseconds. Getting this wrong
      // dates every lead to 1970 and silently breaks "leads this week".
      const created =
        typeof v?.created_time === "number" ? new Date(v.created_time * 1000) : new Date();

      out.push({
        leadgenId,
        formId: typeof v?.form_id === "string" ? v.form_id : null,
        platformAdId: typeof v?.ad_id === "string" ? v.ad_id : null,
        createdAt: created,
      });
    }
  }
  return out;
}

/** Keep only digits, so formatting differences do not change the label. */
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

/**
 * Reduce a full lead record to something recognisable and non-identifying.
 *
 * Rules, in order of preference:
 *   - A first name plus the last four digits of a phone: "Ada ••7391".
 *   - A first name alone, when there is no phone.
 *   - The digits alone, when there is no name.
 *   - "Lead" when the form gave us nothing usable, because a blank row in the
 *     weekly review is worse than an unhelpful one — the owner still needs to
 *     be able to mark it won or lost.
 *
 * ONLY the first name is kept. A full name plus a phone fragment starts to
 * become identifying again, and the surname adds nothing to recognition for
 * someone reviewing their own week's leads.
 */
export function deriveLabel(fields: LeadField[]): string {
  const byName = new Map<string, string>();
  for (const f of fields) {
    const value = (f.values ?? []).find((v) => typeof v === "string" && v.trim() !== "");
    if (value) byName.set(f.name.toLowerCase(), value.trim());
  }

  const rawName =
    byName.get("full_name") ?? byName.get("first_name") ?? byName.get("name") ?? "";
  const first = rawName.split(/\s+/)[0] ?? "";

  const phone = byName.get("phone_number") ?? byName.get("phone") ?? "";
  const tail = digits(phone).slice(-4);

  if (first && tail) return `${first} ••${tail}`;
  if (first) return first;
  if (tail) return `••${tail}`;
  return "Lead";
}

/**
 * Meta's own dedupe key.
 *
 * Meta retries a webhook until it gets a 200, and a retry after a slow write
 * would otherwise create the same lead twice — which inflates every count and,
 * worse, makes a good creative look like it produced more business than it did.
 * The leadgen id is stable across retries, so it is what uniqueness hangs on.
 */
export function dedupeKey(event: LeadgenEvent): string {
  return `meta:${event.leadgenId}`;
}
