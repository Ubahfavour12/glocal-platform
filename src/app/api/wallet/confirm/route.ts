import { NextRequest, NextResponse } from "next/server";
import { usdCreditForVerified, verifyTransaction } from "@/lib/payments/flutterwave";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * UF-2 step 3: Flutterwave redirects the customer here after checkout with
 * ?status&tx_ref&transaction_id. Query params are UNTRUSTED — we verify the
 * transaction against Flutterwave's API, then credit the ledger via the
 * idempotent record_psp_topup. The customer lands back on /wallet either way.
 */
export async function GET(req: NextRequest) {
  const walletUrl = new URL("/wallet", req.nextUrl.origin);
  const status = req.nextUrl.searchParams.get("status");
  const transactionId = req.nextUrl.searchParams.get("transaction_id");

  if (status === "cancelled" || !transactionId) {
    walletUrl.searchParams.set("topup", "cancelled");
    return NextResponse.redirect(walletUrl);
  }

  try {
    const txn = await verifyTransaction(transactionId);
    const businessId = txn.meta?.business_id;
    const fxRate = Number(txn.meta?.fx_rate);

    if (txn.status !== "successful" || !businessId || !(fxRate > 0)) {
      walletUrl.searchParams.set("topup", "failed");
      return NextResponse.redirect(walletUrl);
    }

    // Credit computed from the VERIFIED amount at the rate quoted at checkout.
    const usdMinor = usdCreditForVerified(txn.amountLocalMinor, fxRate);

    const supabase = createServiceClient();
    const { error } = await supabase.rpc("record_psp_topup", {
      p_business_id: businessId,
      p_usd_minor: usdMinor,
      p_local_minor: txn.amountLocalMinor,
      p_local_currency: txn.currency,
      p_fx_rate: fxRate,
      p_psp_ref: `flw-${txn.id}`,
    });
    if (error) throw new Error(error.message);

    walletUrl.searchParams.set("topup", "success");
    return NextResponse.redirect(walletUrl);
  } catch {
    walletUrl.searchParams.set("topup", "error");
    return NextResponse.redirect(walletUrl);
  }
}
