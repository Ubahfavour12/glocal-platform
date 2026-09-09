/**
 * Which money rail a charge runs on.
 *
 * Several rails exist so that one PSP having a bad day, or declining a card
 * type, is not the same as the business being unable to take money. This module
 * is the only place that decides between them, and the only place that builds
 * the ledger's idempotency reference.
 *
 * That second job matters more than it looks. `record_psp_topup` credits once
 * per `psp_ref`, and each charge is settled twice — once by the redirect the
 * customer follows, once by the webhook that fires whether they follow it or
 * not. Those two paths agreeing on the reference is what makes the double
 * settlement safe. If they ever disagreed, every payment would credit twice.
 * So neither path spells the reference itself; both call `pspRef`.
 */

import * as flutterwave from "./flutterwave";
import * as monnify from "./monnify";
import * as paystack from "./paystack";
import type { CheckoutRequest, VerifiedTransaction } from "./shared";

export const PSP_IDS = ["flutterwave", "paystack", "monnify"] as const;
export type PspId = (typeof PSP_IDS)[number];

/**
 * Rails that may open a NEW checkout.
 *
 * Flutterwave is deliberately absent. It is RETIRED, not deleted: it still
 * verifies, refunds and receives webhooks, because charges taken on it before
 * retirement must still settle and must still be refundable for years. What it
 * may no longer do is take a customer's money for the first time.
 *
 * This is a list rather than a check inside activeProvider() because the
 * failure it prevents already happened in production: `PAYMENTS_PROVIDER` was
 * set to "flutterwave" in the hosting environment, which outranked every
 * default in this file, and customers were being sent to a Flutterwave
 * checkout page long after the code here "preferred" Paystack. A preference
 * that an environment variable can silently overrule is not a decision. Being
 * absent from this list cannot be overridden by configuration at all.
 */
export const CHECKOUT_RAILS: readonly PspId[] = ["paystack", "monnify"] as const;

export function canOpenCheckout(psp: PspId): boolean {
  return CHECKOUT_RAILS.includes(psp);
}

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
  monnify,
};

/**
 * The rail NEW checkouts open on.
 *
 * `PAYMENTS_PROVIDER` decides when set. An unrecognised value throws rather
 * than falling back: a typo there would route real money somewhere nobody
 * intended, and a loud failure at checkout is far cheaper to notice than a
 * quiet one. Unset, the order below applies.
 */
export function activeProvider(): PspId {
  const configured = process.env.PAYMENTS_PROVIDER?.trim();
  if (configured) {
    if (!isPspId(configured)) {
      throw new Error(
        `PAYMENTS_PROVIDER must be one of ${CHECKOUT_RAILS.join(" | ")}, got "${configured}"`,
      );
    }
    // A retired rail named here is IGNORED rather than obeyed or thrown on.
    //
    // Throwing would take checkout down completely for a setting that is stale
    // rather than wrong, and obeying it is what put customers on a Flutterwave
    // page in the first place. So we fall through to the order below and say so
    // loudly, which leaves payments working while the variable is cleaned up.
    if (!canOpenCheckout(configured)) {
      console.warn(
        `PAYMENTS_PROVIDER="${configured}" names a retired rail and is being ignored. ` +
          `New checkouts will use ${CHECKOUT_RAILS.join(" then ")}. Remove the variable.`,
      );
    } else {
      return configured;
    }
  }
  // Paystack first, deliberately. It is approved and can take money today, so
  // it is what a customer meets unless told otherwise.
  //
  // Monnify second: the standby, chosen because it fails independently of
  // Paystack (different owner, its own bank rails) and because bank transfer is
  // how much of this market actually pays.
  //
  // Flutterwave appears nowhere here. See CHECKOUT_RAILS.
  if (paystack.isConfigured()) return "paystack";
  if (monnify.isConfigured()) return "monnify";
  // Nothing configured at all. Naming the primary makes the resulting error
  // ("PAYSTACK_SECRET_KEY not configured") point at the rail you actually want.
  return "paystack";
}

/** Is the given rail (default: the active one) able to charge? */
export function isConfigured(psp: PspId = activeProvider()): boolean {
  return RAILS[psp].isConfigured();
}

/**
 * The ledger's idempotency key for a settled charge.
 *
 * These prefixes are load-bearing history: `flw-` entries were written before
 * Paystack existed, so no prefix may ever change or those charges could credit
 * a second time. Add rails here; never rename one.
 */
const REF_PREFIX: Record<PspId, string> = {
  flutterwave: "flw",
  paystack: "ps",
  monnify: "mnfy",
};

export function pspRef(psp: PspId, transactionId: string | number): string {
  return `${REF_PREFIX[psp]}-${transactionId}`;
}

/**
 * The rails to try, in order: the preferred one first, then the other as a
 * standby. A rail with no key is not an option and is left out.
 */
export function checkoutOrder(): PspId[] {
  const first = activeProvider();
  const rest = CHECKOUT_RAILS.filter((p) => p !== first);
  // Filtered through CHECKOUT_RAILS a second time so that even a retired rail
  // returned by activeProvider() could not reach a customer.
  return [first, ...rest].filter((p) => canOpenCheckout(p) && RAILS[p].isConfigured());
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
 * (flw- / ps- / mnfy-), so even the impossible case of both being paid credits
 * twice for two real payments rather than double-crediting one.
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
  // Longest prefix first: "ps" is a prefix of nothing here, but leaving the
  // alternation unordered is the kind of thing that breaks the day a rail
  // named "psX" is added.
  const m = /^(mnfy|flw|ps)-(.+)$/.exec(ref.trim());
  if (!m) return null;
  const psp = (Object.keys(REF_PREFIX) as PspId[]).find((p) => REF_PREFIX[p] === m[1]);
  return psp ? { psp, id: m[2] } : null;
}

/** Refund part or all of a settled charge, on the rail that took it. */
export async function refund(
  ref: string,
  amountLocalMinor: number,
): Promise<{ refundRef: string; psp: PspId }> {
  const parsed = parsePspRef(ref);
  if (!parsed) throw new Error(`unrecognised payment reference "${ref}"`);
  const REFUNDERS: Record<PspId, (id: string, minor: number) => Promise<{ refundRef: string }>> = {
    paystack: paystack.refund,
    monnify: monnify.refund,
    flutterwave: flutterwave.refund,
  };
  const { refundRef } = await REFUNDERS[parsed.psp](parsed.id, amountLocalMinor);
  return { refundRef, psp: parsed.psp };
}

export async function verifyTransaction(
  psp: PspId,
  reference: string,
): Promise<VerifiedTransaction> {
  const VERIFIERS: Record<PspId, (ref: string) => Promise<VerifiedTransaction>> = {
    paystack: paystack.verifyTransaction,
    monnify: monnify.verifyTransaction,
    flutterwave: flutterwave.verifyTransaction,
  };
  return VERIFIERS[psp](reference);
}

export type { CheckoutRequest, VerifiedTransaction } from "./shared";
