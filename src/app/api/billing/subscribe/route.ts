import { NextRequest, NextResponse } from "next/server";
import { createCheckout } from "@/lib/payments/flutterwave";
import { effectiveRate, localCostForUsd } from "@/lib/money/fx";
import { fetchUsdRate } from "@/lib/money/rates";
import { createClient } from "@/lib/supabase/server";
import { isTierId } from "@/lib/billing/subscription";
import { subscriptionPriceUsdMinor, subscriptionTxRef } from "@/lib/billing/subscribe";

/**
 * Start a subscription checkout (Phase 4). A signed-in owner picks a tier → we
 * quote the monthly price in local currency at the buffered rate → hand back
 * Flutterwave's hosted checkout link. The charge carries purpose:"subscription"
 * + tier in meta; the webhook reads that and calls activateSubscription on a
 * successful payment. No wallet credit happens here.
 *
 * Returns 502 until live Flutterwave keys exist — the UI degrades to a
 * "checkout opens when payments go live" note.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { business_id?: string; tier?: string }
    | null;
  if (!body?.business_id || !isTierId(body.tier)) {
    return NextResponse.json(
      { error: "business_id and a valid tier (starter|growth|scale) required" },
      { status: 400 },
    );
  }

  // RLS guarantees this only finds the caller's own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("id", body.business_id)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "business not found" }, { status: 404 });
  }

  const usdMinor = subscriptionPriceUsdMinor(body.tier);

  try {
    const snapshot = await fetchUsdRate("NGN");
    const rate = effectiveRate(snapshot);
    const localMinor = localCostForUsd(usdMinor, snapshot);
    const origin = req.nextUrl.origin;

    const { link } = await createCheckout({
      txRef: subscriptionTxRef(business.id),
      amountLocalMinor: localMinor,
      currency: "NGN",
      customerEmail: userData.user.email ?? "customer@platform.app",
      customerName: business.name,
      redirectUrl: `${origin}/upgrade?subscribed=1`,
      title: "Glocal subscription",
      meta: { business_id: business.id, purpose: "subscription", tier: body.tier },
    });

    return NextResponse.json({
      link,
      quoted: { usd_minor: usdMinor, local_minor: localMinor, currency: "NGN", rate },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checkout failed" },
      { status: 502 },
    );
  }
}
