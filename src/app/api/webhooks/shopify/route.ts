import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { extractClickId, verifyWebhookHmac } from "@/lib/oauth/shopify";
import { fetchUsdRate } from "@/lib/money/rates";

/**
 * Shopify orders/create webhook. Shopify posts every new order here; we verify
 * it against the connected shop's secret, value it in USD, best-effort attribute
 * it back to the ad (via our click id on the order), and record a verified
 * conversion (source "store"). Never errors back at Shopify — a non-2xx makes
 * Shopify retry and eventually disable the webhook.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const shop = req.headers.get("x-shopify-shop-domain");
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!shop) return NextResponse.json({ ok: true }); // nothing to match; ack and move on

  try {
    const supabase = createServiceClient();
    const { data: conn } = await supabase
      .from("store_connections")
      .select("business_id, webhook_secret")
      .eq("shop_domain", shop)
      .eq("status", "active")
      .maybeSingle();
    if (!conn?.webhook_secret) return NextResponse.json({ ok: true });

    if (!verifyWebhookHmac(raw, hmac, conn.webhook_secret as string)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const order = JSON.parse(raw) as {
      id?: number | string;
      total_price?: string;
      currency?: string;
      note_attributes?: { name?: string; value?: string }[];
      landing_site?: string;
    };

    const currency = (order.currency ?? "USD").toUpperCase();
    const amountMinor = Math.round(Number(order.total_price ?? "0") * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return NextResponse.json({ ok: true }); // nothing to record
    }

    let usdMinor = amountMinor;
    if (currency !== "USD") {
      try {
        const snap = await fetchUsdRate(currency);
        usdMinor = Math.round(amountMinor / snap.rate);
      } catch {
        return NextResponse.json({ ok: true, reason: "fx_unavailable" }); // ack, skip
      }
    }

    // Best-effort attribution via our click id carried on the order.
    let adCode: string | null = null;
    const cid = extractClickId(order);
    if (cid) {
      const { data: click } = await supabase
        .from("click_events")
        .select("smart_link_id")
        .eq("app_cid", cid)
        .maybeSingle();
      if (click?.smart_link_id) {
        const { data: link } = await supabase
          .from("smart_links")
          .select("code, business_id")
          .eq("id", click.smart_link_id)
          .maybeSingle();
        if (link && link.business_id === conn.business_id) adCode = link.code as string;
      }
    }

    await supabase.from("conversions").insert({
      business_id: conn.business_id,
      kind: "verified_order",
      value_usd_minor: usdMinor,
      source: "store",
      ad_code: adCode,
      code_source: adCode ? "message" : "none",
      order_ref: order.id ? String(order.id) : null,
    });

    return NextResponse.json({ ok: true, attributed: !!adCode });
  } catch {
    return NextResponse.json({ ok: true }); // never make Shopify retry on our bug
  }
}
