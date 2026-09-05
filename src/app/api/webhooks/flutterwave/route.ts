import { NextRequest, NextResponse } from "next/server";
import { isAuthenticWebhook, verifyTransaction } from "@/lib/payments/flutterwave";
import { settleVerifiedCharge } from "@/lib/payments/settle";
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
 *
 * This route stays live regardless of which rail is currently active, because
 * a charge started on Flutterwave must still settle after a switch away.
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
    const supabase = createServiceClient();
    const outcome = await settleVerifiedCharge(supabase, "flutterwave", txn, {
      sendReceipts: true,
    });

    return NextResponse.json({
      received: true,
      credited: outcome.kind === "credited",
      subscribed: outcome.kind === "subscribed",
      ...(outcome.kind === "ignored" ? { reason: outcome.reason } : {}),
    });
  } catch {
    // 500 → Flutterwave retries; idempotency makes retries safe
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
