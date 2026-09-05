import { NextRequest, NextResponse } from "next/server";
import { isAuthenticWebhook, verifyTransaction } from "@/lib/payments/paystack";
import { settleVerifiedCharge } from "@/lib/payments/settle";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Paystack webhook — the reliability layer on top of redirect-confirm, exactly
 * as the Flutterwave one is. If the customer closes the browser before being
 * redirected, the credit still lands.
 *
 * Authenticity: `x-paystack-signature` is an HMAC-SHA512 of the raw body keyed
 * on the secret key. We read the body as TEXT and hash those exact bytes —
 * parsing first and re-serialising would reorder keys and every genuine
 * webhook would be rejected.
 *
 * This route stays live regardless of which rail is currently active, because
 * a charge started on Paystack must still settle after a switch away from it.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!isAuthenticWebhook(raw, req.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(raw) as { event?: string; data?: { reference?: string } };
    } catch {
      return null;
    }
  })();
  if (body?.event !== "charge.success" || !body.data?.reference) {
    return NextResponse.json({ received: true });
  }

  try {
    // Re-verify against Paystack's API; the webhook body is never trusted for
    // the amount, even though its signature proves who sent it.
    const txn = await verifyTransaction(body.data.reference);
    const supabase = createServiceClient();
    const outcome = await settleVerifiedCharge(supabase, "paystack", txn, { sendReceipts: true });

    return NextResponse.json({
      received: true,
      credited: outcome.kind === "credited",
      subscribed: outcome.kind === "subscribed",
      ...(outcome.kind === "ignored" ? { reason: outcome.reason } : {}),
    });
  } catch {
    // 500 → Paystack retries; idempotency makes retries safe
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
