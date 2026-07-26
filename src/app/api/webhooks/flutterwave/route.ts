import { NextRequest, NextResponse } from "next/server";
import {
  isAuthenticWebhook,
  usdCreditForVerified,
  verifyTransaction,
} from "@/lib/payments/flutterwave";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Flutterwave webhook, the reliability layer on top of redirect-confirm
 * (TRD: webhook ingestion service). Even if the customer closes the browser
 * before redirecting, the credit still lands.
 *
 * Authenticity: `verif-hash` header must equal FLUTTERWAVE_WEBHOOK_HASH
 * (set the same value in the Flutterwave dashboard → Settings → Webhooks).
 * We still re-verify the transaction with their API before crediting;
 * the webhook body itself is never trusted.
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticWebhook(req.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { event?: string; data?: { id?: number; status?: string } }
    | null;
  if (body?.event !== "charge.completed" || !body.data?.id) {
    return NextResponse.json({ received: true });
  }

  try {
    const txn = await verifyTransaction(String(body.data.id));
    const businessId = txn.meta?.business_id;
    const fxRate = Number(txn.meta?.fx_rate);
    if (txn.status !== "successful" || !businessId || !(fxRate > 0)) {
      return NextResponse.json({ received: true, credited: false });
    }

    const usdMinor = usdCreditForVerified(txn.amountLocalMinor, fxRate);
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("record_psp_topup", {
      p_business_id: businessId,
      p_usd_minor: usdMinor,
      p_local_minor: txn.amountLocalMinor,
      p_local_currency: txn.currency,
      p_fx_rate: fxRate,
      p_psp_ref: `flw-${txn.id}`, // same ref as confirm route → idempotent
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ received: true, credited: true });
  } catch {
    // 500 → Flutterwave retries; idempotency makes retries safe
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
