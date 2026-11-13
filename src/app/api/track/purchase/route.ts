import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_BEACON_SALE_USD_MINOR, parsePurchaseParams } from "@/lib/tracking/pixel";
import { fetchUsdRate } from "@/lib/money/rates";
import { checkRateLimit, clientAddress } from "@/lib/net/rate-limit";

/**
 * Website purchase beacon (Phase 2.x, closes website-door ROAS). The pixel
 * reports a purchase from the thank-you page; we match app_cid -> click ->
 * ad, convert to USD, and record a conversion.
 *
 * PUBLIC BY NATURE, AND THAT USED TO BE THE WHOLE DEFENCE. It runs in a
 * buyer's browser, so there is no session to check. The earlier note here
 * called the blast radius "that business's own data" and stopped, which
 * undersold it: revenue is the number the agent uses to decide which ad is
 * winning. Anyone holding a business id -- and it is printed in that site's
 * page source -- could write sales of any size, as often as they liked, and
 * steer a competitor's budget toward a losing ad. The defences now are shape
 * and rate, since identity is not available:
 *
 *   - a ceiling on a single order, so one request cannot write an absurd sale
 *   - one conversion per order reference, enforced by a unique index, so a
 *     replayed URL or a refreshed thank-you page is the same order, not a new one
 *   - a per-visitor and a per-business limit, so a loop is noise for a minute
 *     rather than a rewrite of the month's figures
 *
 * BOTH VERBS, because the pixel calls `navigator.sendBeacon`, which sends a
 * POST. This route only exported GET, so in every browser that has sendBeacon
 * -- all of them -- the purchase was answered with a 405 and the image
 * fallback never ran, because sendBeacon had not thrown. Website purchases
 * could not be recorded at all. GET stays for that image fallback.
 */
async function record(req: NextRequest): Promise<NextResponse> {
  const parsed = parsePurchaseParams(req.nextUrl.searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const businessId = parsed.businessCode;

  // Both limits fail open by design (see rate-limit.ts): a counter that is
  // down must not stop a real shop recording a real sale.
  const [visitor, business] = await Promise.all([
    checkRateLimit("beaconPerVisitor", `${businessId}:${clientAddress(req.headers)}`),
    checkRateLimit("beaconPerBusiness", businessId),
  ]);
  if (!visitor.allowed || !business.allowed) {
    // 200, not 429: this response lands inside a customer's checkout page and
    // must never surface there as an error.
    return NextResponse.json({ ok: false, reason: "rate_limited" });
  }

  try {
    const supabase = createServiceClient();

    // Attribute via the click id our smart link stamped on the destination.
    let adCode: string | null = null;
    if (parsed.cid) {
      const { data: click } = await supabase
        .from("click_events")
        .select("smart_link_id")
        .eq("app_cid", parsed.cid)
        .maybeSingle();
      if (click?.smart_link_id) {
        const { data: link } = await supabase
          .from("smart_links")
          .select("code, business_id")
          .eq("id", click.smart_link_id)
          .maybeSingle();
        if (link && link.business_id === businessId) adCode = link.code as string;
      }
    }

    // True USD value (plain market rate, no buffer, this is a sale, not a top-up).
    let usdMinor = parsed.amountMinor;
    if (parsed.currency !== "USD") {
      try {
        const snap = await fetchUsdRate(parsed.currency);
        usdMinor = Math.round(parsed.amountMinor / snap.rate);
      } catch {
        // Can't value it safely, skip rather than record a wrong number.
        return NextResponse.json({ ok: false, reason: "fx_unavailable" }, { status: 202 });
      }
    }

    // Checked in USD, after conversion: the same ceiling for every currency,
    // rather than a naira limit that means something else in dollars.
    if (usdMinor <= 0 || usdMinor > MAX_BEACON_SALE_USD_MINOR) {
      return NextResponse.json({ ok: false, reason: "implausible_value" });
    }

    const { error } = await supabase.from("conversions").insert({
      business_id: businessId,
      kind: "verified_order",
      value_usd_minor: usdMinor,
      source: "pixel",
      ad_code: adCode,
      code_source: adCode ? "message" : "none",
      order_ref: parsed.orderRef,
    });

    // 23505 is the one-conversion-per-order index: this order is already
    // recorded. That is success from the caller's side -- the sale counts,
    // once -- and saying so keeps a refreshed page from looking like a fault.
    if (error && error.code === "23505") {
      return NextResponse.json({ ok: true, attributed: !!adCode, duplicate: true });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true, attributed: !!adCode });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 }); // never error a beacon
  }
}

export const GET = record;
export const POST = record;
