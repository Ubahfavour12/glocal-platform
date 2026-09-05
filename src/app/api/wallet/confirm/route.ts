import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction, type PspId } from "@/lib/payments/provider";
import { settleVerifiedCharge } from "@/lib/payments/settle";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * UF-2 step 3: the PSP redirects the customer here after checkout. Query
 * params are UNTRUSTED — we verify the charge against the PSP's API, then
 * credit the ledger via the idempotent record_psp_topup. The customer lands
 * back on /wallet either way.
 *
 * Both rails redirect here, and which one did is read from the parameters
 * rather than from the active-provider setting: a charge started on one rail
 * must still settle if the other became active while the customer was still on
 * the payment page.
 *
 *   Flutterwave → ?status=&transaction_id=
 *   Paystack    → ?reference=&trxref=
 *
 * Receipts are deliberately not sent here. The webhook sends them, and it also
 * fires for customers who never follow this redirect; sending from both would
 * email twice for one payment.
 */
function readCallback(
  params: URLSearchParams,
): { psp: PspId; reference: string } | null {
  const transactionId = params.get("transaction_id");
  if (transactionId) return { psp: "flutterwave", reference: transactionId };

  const reference = params.get("reference") ?? params.get("trxref");
  if (reference) return { psp: "paystack", reference };

  return null;
}

export async function GET(req: NextRequest) {
  const walletUrl = new URL("/wallet", req.nextUrl.origin);
  const params = req.nextUrl.searchParams;
  const callback = readCallback(params);

  if (params.get("status") === "cancelled" || !callback) {
    walletUrl.searchParams.set("topup", "cancelled");
    return NextResponse.redirect(walletUrl);
  }

  try {
    const txn = await verifyTransaction(callback.psp, callback.reference);
    const supabase = createServiceClient();
    const outcome = await settleVerifiedCharge(supabase, callback.psp, txn, {
      sendReceipts: false,
    });

    walletUrl.searchParams.set("topup", outcome.kind === "ignored" ? "failed" : "success");
    return NextResponse.redirect(walletUrl);
  } catch {
    walletUrl.searchParams.set("topup", "error");
    return NextResponse.redirect(walletUrl);
  }
}
