/**
 * Which money rail a charge runs on.
 *
 * Two rails exist so that one PSP having a bad day, or declining a card type,
 * is not the same as the business being unable to take money. This module is
 * the only place that decides between them, and the only place that builds the
 * ledger's idempotency reference.
 *
 * That second job matters more than it looks. `record_psp_topup` credits once
 * per `psp_ref`, and each charge is settled twice — once by the redirect the
 * customer follows, once by the webhook that fires whether they follow it or
 * not. Those two paths agreeing on the reference is what makes the double
 * settlement safe. If they ever disagreed, every payment would credit twice.
 * So neither path spells the reference itself; both call `pspRef`.
 */

import * as flutterwave from "./flutterwave";
import * as paystack from "./paystack";
import type { CheckoutRequest, VerifiedTransaction } from "./shared";

export const PSP_IDS = ["flutterwave", "paystack"] as const;
export type PspId = (typeof PSP_IDS)[number];

export function isPspId(value: unknown): value is PspId {
  return typeof value === "string" && (PSP_IDS as readonly string[]).includes(value);
}

const RAILS: Record<PspId, { isConfigured(): boolean }> = {
  flutterwave,
  paystack,
};

/**
 * The rail NEW checkouts open on.
 *
 * `PAYMENTS_PROVIDER` decides when set. An unrecognised value throws rather
 * than falling back: a typo there would route real money somewhere nobody
 * intended, and a loud failure at checkout is far cheaper to notice than a
 * quiet one. Unset, we prefer whichever rail actually has keys, which keeps
 * Flutterwave the default it has always been.
 */
export function activeProvider(): PspId {
  const configured = process.env.PAYMENTS_PROVIDER?.trim();
  if (configured) {
    if (!isPspId(configured)) {
      throw new Error(
        `PAYMENTS_PROVIDER must be one of ${PSP_IDS.join(" | ")}, got "${configured}"`,
      );
    }
    return configured;
  }
  if (flutterwave.isConfigured()) return "flutterwave";
  if (paystack.isConfigured()) return "paystack";
  // Neither is configured. Naming Flutterwave keeps the resulting error the
  // familiar "FLUTTERWAVE_SECRET_KEY not configured" rather than a new one.
  return "flutterwave";
}

/** Is the given rail (default: the active one) able to charge? */
export function isConfigured(psp: PspId = activeProvider()): boolean {
  return RAILS[psp].isConfigured();
}

/**
 * The ledger's idempotency key for a settled charge.
 *
 * `flw-` is load-bearing history: entries written before Paystack existed use
 * it, so it must never change or those charges could credit a second time.
 */
export function pspRef(psp: PspId, transactionId: string | number): string {
  const prefix = psp === "flutterwave" ? "flw" : "ps";
  return `${prefix}-${transactionId}`;
}

/** Open a hosted checkout on the active rail. */
export async function createCheckout(
  req: CheckoutRequest,
): Promise<{ link: string; psp: PspId }> {
  const psp = activeProvider();
  const { link } =
    psp === "paystack" ? await paystack.createCheckout(req) : await flutterwave.createCheckout(req);
  return { link, psp };
}

/**
 * Verify a charge on a named rail.
 *
 * The rail is named by the caller rather than read from `activeProvider()`,
 * because settlement outlives the switch: a charge started on Flutterwave must
 * still verify against Flutterwave even if Paystack became the active rail
 * while the customer was on the payment page.
 */
export async function verifyTransaction(
  psp: PspId,
  reference: string,
): Promise<VerifiedTransaction> {
  return psp === "paystack"
    ? paystack.verifyTransaction(reference)
    : flutterwave.verifyTransaction(reference);
}

export type { CheckoutRequest, VerifiedTransaction } from "./shared";
