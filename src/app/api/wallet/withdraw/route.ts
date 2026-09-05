import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  checkWithdrawal,
  REFUSAL_MESSAGE,
  type WithdrawalDestination,
} from "@/lib/money/withdrawal";

/**
 * Request a withdrawal of unspent wallet balance.
 *
 * Ownership is established with the user-scoped client, so RLS decides which
 * business the caller may act on; the withdrawal itself is performed by
 * `request_withdrawal`, which locks the wallet and writes the reserving debit
 * in one transaction.
 *
 * The balance is checked twice on purpose. Here, so the customer gets a
 * specific sentence about their own money instead of a database error; and
 * again inside that function, which is the check that actually counts, because
 * only it holds the lock. Two taps of the button arriving together both pass
 * this check and only one survives the unique index on open requests.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { business_id?: string; usd_minor?: number; destination?: Partial<WithdrawalDestination> }
    | null;
  if (!body?.business_id) {
    return NextResponse.json({ error: "business_id required" }, { status: 400 });
  }

  // RLS guarantees this only finds the caller's own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", body.business_id)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "business not found" }, { status: 404 });
  }

  const { data: balanceRow } = await supabase
    .from("wallet_balances")
    .select("balance_usd_minor")
    .eq("business_id", business.id)
    .maybeSingle();

  const { count: pendingCount } = await supabase
    .from("withdrawals")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .eq("status", "requested");

  const verdict = checkWithdrawal({
    amountUsdMinor: Number(body.usd_minor),
    balanceUsdMinor: Number(balanceRow?.balance_usd_minor ?? 0),
    destination: body.destination ?? null,
    hasPendingWithdrawal: (pendingCount ?? 0) > 0,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { error: REFUSAL_MESSAGE[verdict.reason], reason: verdict.reason },
      { status: 400 },
    );
  }

  const d = body.destination as WithdrawalDestination;
  const service = createServiceClient();
  const { data: withdrawalId, error } = await service.rpc("request_withdrawal", {
    p_business_id: business.id,
    p_amount_usd_minor: body.usd_minor,
    p_destination: {
      bank_name: d.bankName.trim(),
      account_number: d.accountNumber.trim(),
      account_name: d.accountName.trim(),
    },
  });

  if (error) {
    // The lock-holding check refused it. Most likely the balance moved between
    // our read and the request, or a concurrent tap won the open-request index.
    const raced = /exceeds withdrawable balance|withdrawals_one_pending/i.test(error.message);
    return NextResponse.json(
      {
        error: raced
          ? "Your balance changed just now, so this withdrawal was not made. Check the amount and try again."
          : "Could not start the withdrawal. Nothing has been taken from your wallet.",
      },
      { status: raced ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, withdrawal_id: withdrawalId });
}
