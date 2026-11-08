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
import { feeUsdMinor, usdCreditForVerified, type VerifiedTransaction } from "./shared";
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

  /**
   * Record what the processor kept.
   *
   * NOT on the ledger. The ledger is what the CUSTOMER may spend, and this fee
   * comes out of what reaches our account, not out of their balance -- writing
   * it as a wallet debit would quietly contradict the promise on the Add Funds
   * screen. It goes to `payment_fees`, beside `llm_usage`, as a cost to serve.
   *
   * Unique on psp_ref, because the redirect and the webhook both settle the
   * same charge by design and only one fee was paid. Never throws: a charge
   * that credited correctly must not be failed by a cost record, which would
   * make the PSP retry and the customer wait.
   */
  /**
   * Issue the customer's invoice.
   *
   * A numbered document per payment, which the ledger and the receipt email
   * between them did not provide: the ledger is a running balance and the
   * email is not something you can file or hand to an accountant.
   *
   * Idempotent on the PSP reference inside the database function, because the
   * redirect and the webhook both settle the same charge on purpose and a
   * customer must never receive two invoices for one payment.
   *
   * Never throws. The money has moved correctly; a missing document is worth
   * recording, not worth making the PSP retry a settled charge.
   */
  const issueInvoiceFor = async (
    kind: "topup" | "subscription",
    usdMinor: number,
    description: string,
  ) => {
    try {
      await supabase.rpc("issue_invoice", {
        p_business_id: businessId,
        p_kind: kind,
        p_amount_usd_minor: usdMinor,
        p_amount_local_minor: txn.amountLocalMinor,
        p_local_currency: txn.currency,
        p_fx_rate: fxRate,
        p_description: description,
        p_psp: psp,
        p_psp_ref: pspRef(psp, txn.id),
      });
    } catch {
      /* see above */
    }
  };

  const recordFee = async () => {
    const usd = feeUsdMinor(txn.feeLocalMinor, fxRate);
    if (usd === null) return; // this rail did not report a fee
    try {
      await supabase.from("payment_fees").insert({
        business_id: businessId,
        psp,
        psp_ref: pspRef(psp, txn.id),
        charge_local_minor: txn.amountLocalMinor,
        fee_local_minor: txn.feeLocalMinor,
        local_currency: txn.currency,
        fx_rate: fxRate,
        fee_usd_minor: usd,
      });
    } catch {
      // Duplicate key on a second settle of the same charge, or anything
      // else. Either way the money moved correctly and that is what matters.
    }
  };

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
    // A subscription charge costs us a processor fee exactly as a top-up does.
    await recordFee();
    await issueInvoiceFor(
      "subscription",
      expectedUsdMinor,
      // Capitalised: the tier is a proper noun on the customer's invoice, and
      // the raw column value is lowercase. Caught by looking at a rendered
      // invoice rather than at the string.
      `Glocal ${charge.tier.charAt(0).toUpperCase()}${charge.tier.slice(1)} plan — one month`,
    );
    if (opts.sendReceipts) {
      const sent = await sendReceiptForBusiness(supabase, businessId, {
        type: "subscription",
        tier: charge.tier,
        amountUsdMinor: expectedUsdMinor,
      });
      await noteUnsentReceipt(supabase, businessId, sent, psp, txn.id);
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

  await recordFee();
  await issueInvoiceFor("topup", paidUsdMinor, "Wallet top-up");

  if (opts.sendReceipts) {
    const sent = await sendReceiptForBusiness(supabase, businessId, {
      type: "topup",
      amountUsdMinor: paidUsdMinor,
    });
    await noteUnsentReceipt(supabase, businessId, sent, psp, txn.id);
  }
  return { kind: "credited", usdMinor: paidUsdMinor };
}

/**
 * Write down a receipt that did not go out.
 *
 * `sendReceiptForBusiness` never throws -- it returns { sent: false, reason }
 * -- and both call sites used to discard that. So the one piece of evidence a
 * customer gets that their money arrived could fail silently, for every
 * payment, and nothing anywhere would say so. The most likely cause is the
 * most invisible one: RESEND_API_KEY unset makes sending a no-op.
 *
 * Recorded, not thrown. The money has already moved correctly and a missing
 * email must not make the PSP retry a settled charge.
 */
async function noteUnsentReceipt(
  supabase: SupabaseClient,
  businessId: string,
  result: { sent: boolean; reason?: string },
  psp: PspId,
  txnId: number | string,
): Promise<void> {
  if (result.sent) return;
  try {
    await supabase.from("audit_log").insert({
      business_id: businessId,
      actor: `webhook:${psp}`,
      action: "receipt_not_sent",
      detail: { reason: result.reason ?? "unknown", txnId: String(txnId) },
    });
  } catch {
    // Bookkeeping about bookkeeping. Never worth failing a settled charge.
  }
}
