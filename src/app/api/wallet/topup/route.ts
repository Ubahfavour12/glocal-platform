import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Dev top-up (Task #3 scaffolding): credits small test amounts through the
 * capped `record_dev_topup` Postgres function. The real PSP checkout replaces
 * the body of this route; the contract (POST → ledger credit → new balance)
 * stays identical, so nothing downstream changes when Stripe/Flutterwave land.
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
  if (!body?.business_id || !Number.isInteger(body.usd_minor) || body.usd_minor! <= 0) {
    return NextResponse.json({ error: "business_id and positive usd_minor required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("record_dev_topup", {
    p_business_id: body.business_id,
    p_usd_minor: body.usd_minor,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: balance } = await supabase
    .from("wallet_balances")
    .select("balance_usd_minor")
    .eq("business_id", body.business_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    balance_usd_minor: balance?.balance_usd_minor ?? null,
  });
}
