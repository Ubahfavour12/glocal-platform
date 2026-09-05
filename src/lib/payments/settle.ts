/**
 * What happens after a charge is verified — the only copy.
 *
 * Every settled charge arrives twice: once when the customer follows the
 * redirect, once when the PSP posts its webhook. With two rails that is four
 * entry points into the same money logic, and four copies of "decide what this
 * charge was for, check it covers the tier, credit the ledger" is four chances
 * for the rails to disagree about money. So they all call this.
 *
 * Receipts are the one thing NOT shared by all four. They are not deduplicated,
 * so sending from both the redirect and the webhook would email the customer
 * twice for a single top-up. The webhook sends; the redirect does not. That is
 * why `sendReceipts` is an explicit argument rather than something inferred.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { activateSubscription, type TierId } from "@/lib/billing/subscription";
import {
  classifyCharge,
  coversSubscription,
  subscriptionPriceUsdMinor,
} from "@/lib/billing/subscribe";
import { sendReceiptForBusiness } from "@/lib/billing/receipt";
import { usdCreditForVerified, type VerifiedTransaction } from "./shared";
import { pspRef, type PspId } from "./provider";

export type SettlementOutcome =
  | { kind: "credited"; usdMinor: number }
  | { kind: "subscribed"; tier: TierId }
  | { kind: "ignored"; reason: string };

/**
 * Apply a VERIFIED charge to the ledger.
 *
 * `txn` must come from the PSP's verify API, never from a webhook body or a
 * redirect's query string — this function trusts the amount it is given.
 */
export async function settleVerifiedCharge(
  supabase: SupabaseClient,
  psp: PspId,
  txn: VerifiedTransaction,
  opts: { sendReceipts: boolean },
): Promise<SettlementOutcome> {
  if (txn.status !== "successful") return { kind: "ignored", reason: "not successful" };

  const charge = classifyCharge(txn.meta);
  if (charge.kind === "ignore") return { kind: "ignored", reason: "unrecognised charge" };

  const businessId = txn.meta!.business_id!;
  const fxRate = Number(txn.meta?.fx_rate);
  if (!(fxRate > 0)) return { kind: "ignored", reason: "no rate" };

  const paidUsdMinor = usdCreditForVerified(txn.amountLocalMinor, fxRate);

  if (charge.kind === "subscription") {
    const expectedUsdMinor = subscriptionPriceUsdMinor(charge.tier);

    // Never activate a tier on an underpayment. The tier travels in the
    // charge's metadata, so without this check anything that could get a cheap
    // charge tagged with an expensive tier would unlock it. The amount here
    // comes from the PSP's verify API, not the webhook body.
    if (!coversSubscription(paidUsdMinor, expectedUsdMinor)) {
      await supabase.from("audit_log").insert({
        business_id: businessId,
        actor: `webhook:${psp}`,
        action: "subscription_underpaid",
        detail: { tier: charge.tier, expectedUsdMinor, paidUsdMinor, txnId: txn.id },
      });
      return { kind: "ignored", reason: "underpaid" };
    }

    await activateSubscription(supabase, businessId, charge.tier);
    if (opts.sendReceipts) {
      await sendReceiptForBusiness(supabase, businessId, {
        type: "subscription",
        tier: charge.tier,
        amountUsdMinor: expectedUsdMinor,
      });
    }
    return { kind: "subscribed", tier: charge.tier };
  }

  // Wallet top-up. Idempotent on the psp reference, which is what makes the
  // redirect and the webhook both settling the same charge harmless.
  const { error } = await supabase.rpc("record_psp_topup", {
    p_business_id: businessId,
    p_usd_minor: paidUsdMinor,
    p_local_minor: txn.amountLocalMinor,
    p_local_currency: txn.currency,
    p_fx_rate: fxRate,
    p_psp_ref: pspRef(psp, txn.id),
  });
  if (error) throw new Error(error.message);

  if (opts.sendReceipts) {
    await sendReceiptForBusiness(supabase, businessId, {
      type: "topup",
      amountUsdMinor: paidUsdMinor,
    });
  }
  return { kind: "credited", usdMinor: paidUsdMinor };
}
