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
 * window.glocalTrack.purchase(value, orderId) for the thank-you page.
 */
export function buildPixelJs(businessCode: string, origin: string): string {
  return `(function(){
  try {
    var p = new URLSearchParams(location.search);
    var cid = p.get('app_cid');
    if (cid) { try { localStorage.setItem('glocal_cid', cid); } catch(e){} }
    window.glocalTrack = {
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

/** Pure: parse + validate the purchase beacon's query params. */
export function parsePurchaseParams(params: URLSearchParams): PurchaseParams | { error: string } {
  const businessCode = params.get("b")?.trim() ?? "";
  if (!businessCode) return { error: "missing business code" };

  const rawValue = Number(params.get("value"));
  if (!Number.isFinite(rawValue) || rawValue <= 0) return { error: "invalid value" };
  const amountMinor = Math.round(rawValue * 100);

  const currency = (params.get("currency") || "USD").toUpperCase().slice(0, 3);
  const cid = params.get("cid")?.trim() || null;
  const orderRef = params.get("order")?.trim() || null;

  return { businessCode, cid, amountMinor, currency, orderRef };
}
