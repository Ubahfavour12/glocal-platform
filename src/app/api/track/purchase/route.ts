import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parsePurchaseParams } from "@/lib/tracking/pixel";
import { fetchUsdRate } from "@/lib/money/rates";

/**
 * Website purchase beacon (Phase 2.x, closes website-door ROAS). The pixel
 * reports a purchase from the thank-you page; we match app_cid -> click ->
 * ad, convert to USD, and record a verified conversion. A public endpoint by
 * nature (no auth on the buyer's browser), so it does the minimum: resolve,
 * convert, insert. It only ever writes a sale attributed to the business in
 * the pixel code, so the blast radius of abuse is that business's own data.
 */
export async function GET(req: NextRequest) {
  const parsed = parsePurchaseParams(req.nextUrl.searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const businessId = parsed.businessCode;

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

    await supabase.from("conversions").insert({
      business_id: businessId,
      kind: "verified_order",
      value_usd_minor: usdMinor,
      source: "pixel",
      ad_code: adCode,
      code_source: adCode ? "message" : "none",
      order_ref: parsed.orderRef,
    });

    return NextResponse.json({ ok: true, attributed: !!adCode });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 }); // never error a beacon
  }
}
