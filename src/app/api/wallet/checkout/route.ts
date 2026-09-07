import { NextRequest, NextResponse } from "next/server";
import { createCheckout } from "@/lib/payments/provider";
import { effectiveRate, localCostForUsd } from "@/lib/money/fx";
import { fetchUsdRate } from "@/lib/money/rates";
import { pspChargeCurrency } from "@/lib/money/currency";
import { createClient } from "@/lib/supabase/server";

/**
 * UF-2 step 2: signed-in owner requests a top-up of X USD → we quote the
 * final local price at the buffered rate and hand back the active rail's
 * hosted checkout link. The quoted fx rate travels in meta so the confirm step
 * credits at exactly the quoted rate.
 *
 * Which rail that is comes from the provider router, and the answer is
 * returned to the caller so a support conversation about a specific payment
 * does not have to guess which PSP to go looking in.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { business_id?: string; usd_minor?: number }
    | null;
  if (!body?.business_id || !Number.isInteger(body.usd_minor) || body.usd_minor! < 1000) {
    return NextResponse.json(
      { error: "business_id and usd_minor >= 1000 ($10 minimum) required" },
      { status: 400 },
    );
  }

  // RLS guarantees this only finds the caller's own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, currency")
    .eq("id", body.business_id)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "business not found" }, { status: 404 });
  }

  try {
    // The currency the customer signed up in, not a hardcoded one. USD stays
    // the canonical ledger amount and the conversion happens here, so someone
    // in Accra is quoted cedis rather than being asked to pay in naira.
    const currency = pspChargeCurrency(business.currency as string | null);
    const snapshot = await fetchUsdRate(currency);
    const rate = effectiveRate(snapshot);
    const localMinor = localCostForUsd(body.usd_minor!, snapshot);
    const txRef = `topup-${business.id.slice(0, 8)}-${Date.now()}`;
    const origin = req.nextUrl.origin;

    const { link, psp } = await createCheckout({
      txRef,
      amountLocalMinor: localMinor,
      currency,
      customerEmail: userData.user.email ?? "customer@platform.app",
      customerName: business.name,
      redirectUrl: `${origin}/api/wallet/confirm`,
      meta: { business_id: business.id, usd_minor: body.usd_minor!, fx_rate: rate },
    });

    return NextResponse.json({
      link,
      psp,
      quoted: { usd_minor: body.usd_minor, local_minor: localMinor, currency, rate },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checkout failed" },
      { status: 502 },
    );
  }
}
