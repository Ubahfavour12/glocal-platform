import { NextRequest, NextResponse } from "next/server";
import { isAuthenticWebhook, verifyTransaction } from "@/lib/payments/monnify";
import { settleVerifiedCharge } from "@/lib/payments/settle";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Monnify webhook — the reliability layer on top of redirect-confirm, exactly
 * as the Paystack one is. If the customer closes the browser before being
 * redirected, the credit still lands.
 *
 * Authenticity: `monnify-signature` is an HMAC-SHA512 of the raw body keyed on
 * the secret key. We read the body as TEXT and hash those exact bytes —
 * parsing first and re-serialising would reorder keys and every genuine
 * webhook would be rejected.
 *
 * Where this differs from Paystack: the event name is `SUCCESSFUL_TRANSACTION`
 * and the payload sits under `eventData`, whose `transactionReference` is what
 * verification takes (not `paymentReference`, which is our own txRef and would
 * 404 against the v2 endpoint).
 *
 * This route stays live regardless of which rail is currently active, because
 * a charge started on Monnify must still settle after a switch away from it.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!isAuthenticWebhook(raw, req.headers.get("monnify-signature"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(raw) as {
        eventType?: string;
        eventData?: { transactionReference?: string };
      };
    } catch {
      return null;
    }
  })();
  if (body?.eventType !== "SUCCESSFUL_TRANSACTION" || !body.eventData?.transactionReference) {
    return NextResponse.json({ received: true });
  }

  try {
    // Re-verify against Monnify's API; the webhook body is never trusted for
    // the amount, even though its signature proves who sent it.
    const txn = await verifyTransaction(body.eventData.transactionReference);
    const supabase = createServiceClient();
    const outcome = await settleVerifiedCharge(supabase, "monnify", txn, { sendReceipts: true });

    return NextResponse.json({
      received: true,
      credited: outcome.kind === "credited",
      subscribed: outcome.kind === "subscribed",
      ...(outcome.kind === "ignored" ? { reason: outcome.reason } : {}),
    });
  } catch {
    // 500 → Monnify retries; idempotency makes retries safe
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
