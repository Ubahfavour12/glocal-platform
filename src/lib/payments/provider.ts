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

interface Rail {
  isConfigured(): boolean;
  createCheckout(req: CheckoutRequest): Promise<{ link: string }>;
}

const RAILS: Record<PspId, Rail> = {
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

/**
 * The rails to try, in order: the preferred one first, then the other as a
 * standby. A rail with no key is not an option and is left out.
 */
export function checkoutOrder(): PspId[] {
  const first = activeProvider();
  const rest = PSP_IDS.filter((p) => p !== first);
  return [first, ...rest].filter((p) => RAILS[p].isConfigured());
}

export class NoRailAvailableError extends Error {
  constructor(readonly attempts: { psp: PspId; error: string }[]) {
    super(
      attempts.length === 0
        ? "No payment rail is configured"
        : `Every payment rail failed: ${attempts.map((a) => `${a.psp} (${a.error})`).join(", ")}`,
    );
    this.name = "NoRailAvailableError";
  }
}

/**
 * Open a hosted checkout, falling back to the other rail if the first one
 * cannot produce a link.
 *
 * Failing over here is safe for one specific reason: creating a checkout moves
 * no money. It asks the PSP for a URL. If Flutterwave is down, times out, or
 * refuses, the customer has not paid anything, so trying Paystack cannot
 * double-charge them -- they are simply handed a working link instead of an
 * error. The same reasoning is why this must never be extended to verification
 * or settlement, where money HAS moved and a retry on the wrong rail would be
 * a second charge.
 *
 * A checkout that was half-created on the failed rail is abandoned unpaid. It
 * carries the same txRef, but the ledger keys on the PSP's own reference
 * (flw- / ps-), so even the impossible case of both being paid credits twice
 * for two real payments rather than double-crediting one.
 */
export async function createCheckout(
  req: CheckoutRequest,
): Promise<{ link: string; psp: PspId }> {
  const attempts: { psp: PspId; error: string }[] = [];

  for (const psp of checkoutOrder()) {
    try {
      const { link } = await RAILS[psp].createCheckout(req);
      return { link, psp };
    } catch (e) {
      attempts.push({ psp, error: (e as Error).message });
    }
  }

  throw new NoRailAvailableError(attempts);
}

/**
 * Verify a charge on a named rail.
 *
 * The rail is named by the caller rather than read from `activeProvider()`,
 * because settlement outlives the switch: a charge started on Flutterwave must
 * still verify against Flutterwave even if Paystack became the active rail
 * while the customer was on the payment page.
 */
/**
 * Split a ledger reference back into the rail that made it and that rail's own
 * id. The inverse of pspRef, and the only place that knows the prefixes, so a
 * refund can never be sent to the wrong provider.
 */
export function parsePspRef(ref: string): { psp: PspId; id: string } | null {
  const m = /^(flw|ps)-(.+)$/.exec(ref.trim());
  if (!m) return null;
  return { psp: m[1] === "flw" ? "flutterwave" : "paystack", id: m[2] };
}

/** Refund part or all of a settled charge, on the rail that took it. */
export async function refund(
  ref: string,
  amountLocalMinor: number,
): Promise<{ refundRef: string; psp: PspId }> {
  const parsed = parsePspRef(ref);
  if (!parsed) throw new Error(`unrecognised payment reference "${ref}"`);
  const { refundRef } =
    parsed.psp === "paystack"
      ? await paystack.refund(parsed.id, amountLocalMinor)
      : await flutterwave.refund(parsed.id, amountLocalMinor);
  return { refundRef, psp: parsed.psp };
}

export async function verifyTransaction(
  psp: PspId,
  reference: string,
): Promise<VerifiedTransaction> {
  return psp === "paystack"
    ? paystack.verifyTransaction(reference)
    : flutterwave.verifyTransaction(reference);
}

export type { CheckoutRequest, VerifiedTransaction } from "./shared";
