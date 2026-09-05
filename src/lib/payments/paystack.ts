/**
 * Paystack integration — the second money rail (Blueprint §5.1 PSP-held).
 *
 * Deliberately the same shape as `flutterwave.ts`: quote USD→NGN at the
 * buffered rate → open a hosted checkout → customer pays on Paystack's page →
 * redirect back → we VERIFY against Paystack's API (never trust query params
 * or a webhook body) → credit the ledger idempotently via record_psp_topup.
 *
 * Four places where Paystack is NOT Flutterwave, each of which silently
 * corrupts money if mirrored carelessly:
 *
 *  1. Amounts are MINOR units (kobo). Flutterwave takes major units, so
 *     copying that conversion here would charge one hundredth of the price.
 *  2. The envelope's success flag is the boolean `true`, not the string
 *     "success".
 *  3. A settled charge reads "success", not "successful".
 *  4. A webhook proves itself with an HMAC of the raw body keyed on the secret
 *     key — not a static shared hash. There is no separate hash to configure,
 *     and nothing to leave empty by accident.
 */

import {
  constantTimeEquals,
  hmacSha512Hex,
  parseMeta,
  type CheckoutRequest,
  type VerifiedTransaction,
} from "./shared";

const API = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not configured");
  return key;
}

/** Is this rail configured at all? Lets the router prefer a rail that works. */
export function isConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

async function ps<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await res.json()) as { status?: boolean; message?: string; data?: unknown };
  // Strict `!== true`: Paystack's flag is a boolean, and a loose check would
  // accept a truthy string on a response shape we did not expect.
  if (data.status !== true) {
    throw new Error(`Paystack ${path}: ${data.message ?? "request failed"}`);
  }
  return data.data as T;
}

/** Create a hosted checkout page; returns the URL to send the customer to. */
export async function createCheckout(req: CheckoutRequest): Promise<{ link: string }> {
  if (!Number.isInteger(req.amountLocalMinor) || req.amountLocalMinor <= 0) {
    throw new Error("amount must be positive integer minor units");
  }
  const data = await ps<{ authorization_url: string; reference: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        reference: req.txRef,
        // Minor units, passed straight through. See note 1 in the file header.
        amount: req.amountLocalMinor,
        currency: req.currency,
        email: req.customerEmail,
        callback_url: req.redirectUrl,
        metadata: {
          ...req.meta,
          customer_name: req.customerName,
          // Paystack renders custom_fields on the checkout page and the receipt.
          custom_fields: [
            {
              display_name: "Purpose",
              variable_name: "purpose",
              value: req.title ?? "Wallet top-up",
            },
          ],
        },
      }),
    },
  );
  return { link: data.authorization_url };
}

/**
 * Verify a transaction by its reference (the `reference`/`trxref` Paystack
 * hands back on redirect, and the one carried in the webhook body).
 */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const data = await ps<{
    id: number;
    reference: string;
    status: string;
    amount: number;
    currency: string;
    metadata: unknown;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  return {
    id: data.id,
    txRef: data.reference,
    // Normalised to the rest of the codebase's spelling. See note 3.
    status: data.status === "success" ? "successful" : data.status,
    // Already minor units — no conversion, deliberately.
    amountLocalMinor: data.amount,
    currency: data.currency,
    meta: parseMeta(data.metadata),
  };
}

/**
 * Webhook authenticity: `x-paystack-signature` is HMAC-SHA512 of the exact
 * bytes Paystack sent, keyed with the secret key. Pass the raw body string,
 * never a re-serialised object.
 *
 * Unlike Flutterwave's static hash there is nothing extra to configure: if the
 * rail can charge at all, it can already authenticate its own webhooks.
 */
export function isAuthenticWebhook(rawBody: string, signature: string | null): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !signature) return false;
  return constantTimeEquals(hmacSha512Hex(key, rawBody), signature);
}

export { usdCreditForVerified } from "./shared";
export type { CheckoutRequest, VerifiedTransaction } from "./shared";
