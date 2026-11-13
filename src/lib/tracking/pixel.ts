/**
 * Website conversion pixel — closes website-door ROAS.
 * The customer pastes one line into their site. The pixel captures the
 * `app_cid` our smart link stamped on the ad's destination URL, then reports a
 * purchase from their thank-you page. We match app_cid -> click -> ad, so a
 * website seller gets true revenue per ad, effortlessly.
 *
 * Pure helpers here (JS generation, param parsing) are fixture-tested; the
 * routes wrap them.
 */

/** The one-liner the customer pastes on every page. */
export function pixelSnippet(businessCode: string, origin: string): string {
  return `<script async src="${origin}/px/${businessCode}.js"></script>`;
}

/**
 * The served pixel script. On load it stores app_cid; it exposes
 * window.glocalTrack.purchase(value, orderId) for the thank-you page and
 * window.glocalTrack.lead(name) for an enquiry form.
 *
 * `lead()` exists so a website seller never has to type a lead in by hand.
 * The click id was stamped on the landing URL by our own redirect and stored
 * here on arrival, so the enquiry attributes itself to the exact ad with no
 * human step — and unlike the WhatsApp prefill, the visitor never sees or
 * types it.
 *
 * ONLY A NAME IS SENT, and only so the owner can recognise the enquiry in
 * their weekly review. Passing an email or a phone number would make Glocal a
 * store of the customer's own customers' contact details, which is the thing
 * the whole lead design avoids; the server truncates whatever arrives to a
 * short label regardless of what a site sends.
 */
export function buildPixelJs(businessCode: string, origin: string): string {
  return `(function(){
  try {
    var p = new URLSearchParams(location.search);
    var cid = p.get('app_cid');
    if (cid) { try { localStorage.setItem('glocal_cid', cid); } catch(e){} }
    window.glocalTrack = {
      lead: function(name) {
        var c = '';
        try { c = localStorage.getItem('glocal_cid') || ''; } catch(e){}
        var u = '${origin}/api/track/lead?b=${businessCode}'
          + '&cid=' + encodeURIComponent(c)
          + '&name=' + encodeURIComponent(String(name || '').slice(0, 40));
        try { navigator.sendBeacon(u); } catch(e) { new Image().src = u; }
      },
      purchase: function(value, orderId, currency) {
        var c = '';
        try { c = localStorage.getItem('glocal_cid') || ''; } catch(e){}
        var u = '${origin}/api/track/purchase?b=${businessCode}'
          + '&cid=' + encodeURIComponent(c)
          + '&value=' + encodeURIComponent(value || 0)
          + '&currency=' + encodeURIComponent(currency || 'USD')
          + '&order=' + encodeURIComponent(orderId || '');
        try { navigator.sendBeacon(u); } catch(e) { new Image().src = u; }
      }
    };
  } catch(e){}
})();`;
}

export interface PurchaseParams {
  businessCode: string;
  cid: string | null;
  amountMinor: number; // in the reported currency
  currency: string;
  orderRef: string | null;
}

export interface LeadBeaconParams {
  businessCode: string;
  cid: string | null;
  /** A first name at most. Never an email or a phone number. */
  label: string;
}

/**
 * The shape of every id these beacons carry.
 *
 * Both the business code and the click id are UUIDs we minted ourselves. A
 * public endpoint should refuse anything else at the door rather than hand it
 * to the database to reject: the refusal is cheaper, and a malformed value
 * reaching a query is the start of most bad afternoons.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A click id that could not have come from our redirect is treated as absent. */
function readClickId(params: URLSearchParams): string | null {
  const cid = params.get("cid")?.trim() ?? "";
  return UUID.test(cid) ? cid : null;
}

/**
 * Pure: parse the lead beacon.
 *
 * The name is reduced HERE rather than trusted, because the site calling this
 * is the customer's and may pass anything — a full name, an email, a whole
 * form payload. Only the first word survives, capped, and anything with an @
 * or a run of digits is dropped entirely: those are contact details, and this
 * label exists to jog a memory, not to store a person.
 */
export function parseLeadBeacon(params: URLSearchParams): LeadBeaconParams | { error: string } {
  const businessCode = params.get("b")?.trim() ?? "";
  if (!businessCode) return { error: "missing business code" };
  if (!UUID.test(businessCode)) return { error: "invalid business code" };

  const raw = (params.get("name") ?? "").trim();
  const first = raw.split(/\s+/)[0] ?? "";
  const looksLikeContact = first.includes("@") || /\d{4,}/.test(first);
  const label = looksLikeContact || first === "" ? "Website enquiry" : first.slice(0, 24);

  return { businessCode, cid: readClickId(params), label };
}

/**
 * The largest single order a beacon may report, in USD minor units.
 *
 * $100,000. No local business sells that through a thank-you page, and the
 * number exists for the other case: this endpoint is public, the value is
 * whatever the caller typed, and without a ceiling one request could write a
 * billion-dollar sale into the figures the agent steers by. Anything above it
 * is dropped rather than clamped -- a clamped lie is still a lie in the data.
 */
export const MAX_BEACON_SALE_USD_MINOR = 10_000_000;

/** Pure: parse + validate the purchase beacon's query params. */
export function parsePurchaseParams(params: URLSearchParams): PurchaseParams | { error: string } {
  const businessCode = params.get("b")?.trim() ?? "";
  if (!businessCode) return { error: "missing business code" };
  if (!UUID.test(businessCode)) return { error: "invalid business code" };

  const rawValue = Number(params.get("value"));
  if (!Number.isFinite(rawValue) || rawValue <= 0) return { error: "invalid value" };
  const amountMinor = Math.round(rawValue * 100);
  if (!Number.isSafeInteger(amountMinor)) return { error: "invalid value" };

  const currency = (params.get("currency") || "USD").trim().toUpperCase();
  // Three letters or nothing. It becomes a lookup key into the rate table, and
  // a currency we cannot value must fail here rather than be guessed at.
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "invalid currency" };

  // Capped, because it becomes part of a unique key and is stored verbatim.
  const orderRef = params.get("order")?.trim().slice(0, 120) || null;

  return { businessCode, cid: readClickId(params), amountMinor, currency, orderRef };
}
