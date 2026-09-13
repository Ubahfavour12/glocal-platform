/**
 * Flutterwave integration — Task #3 completion (Blueprint §5.1 PSP-held).
 * Flow (UF-2): quote USD→NGN at the buffered rate → create hosted checkout →
 * customer pays on Flutterwave's page → redirect back → we VERIFY the
 * transaction against Flutterwave's API (never trust query params) → credit
 * the ledger idempotently via record_psp_topup.
 *
 * Money safety rules:
 *  - The verified amount/currency from Flutterwave's API is authoritative.
 *  - USD credited is computed from the verified local amount at the same
 *    buffered rate quoted at checkout (stored in meta), floor-rounded.
 *  - record_psp_topup is idempotent on the transaction reference.
 *
 * The ledger-facing pieces (the credit arithmetic, the charge metadata shape,
 * the constant-time compare) now live in `shared.ts` so the Paystack rail
 * cannot drift onto different arithmetic. This file keeps its original public
 * surface; only the implementations moved.
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
import { constantTimeEquals, type CheckoutRequest, type VerifiedTransaction } from "./shared";

const API = "https://api.flutterwave.com/v3";

function secretKey(): string {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) throw new Error("FLUTTERWAVE_SECRET_KEY not configured");
  return key;
}

/** Is this rail configured at all? Lets the router prefer a rail that works. */
export function isConfigured(): boolean {
  return Boolean(process.env.FLUTTERWAVE_SECRET_KEY);
}

async function fw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await res.json()) as { status: string; message?: string; data?: unknown };
  if (data.status !== "success") {
    throw new Error(`Flutterwave ${path}: ${data.message ?? "request failed"}`);
  }
  return data.data as T;
}

/** Create a hosted checkout page; returns the URL to send the customer to. */
export async function createCheckout(req: CheckoutRequest): Promise<{ link: string }> {
  if (!Number.isInteger(req.amountLocalMinor) || req.amountLocalMinor <= 0) {
    throw new Error("amount must be positive integer minor units");
  }
  return fw<{ link: string }>("/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: req.txRef,
      // Flutterwave amounts are major units; minor→major exactly
      amount: (req.amountLocalMinor / 100).toFixed(2),
      currency: req.currency,
      redirect_url: req.redirectUrl,
      customer: { email: req.customerEmail, name: req.customerName },
      meta: req.meta,
      customizations: { title: req.title ?? "Wallet top-up" },
    }),
  });
}

/** Verify a transaction by Flutterwave's numeric transaction id. */
export async function verifyTransaction(transactionId: string): Promise<VerifiedTransaction> {
  const data = await fw<{
    id: number;
    tx_ref: string;
    status: string;
    amount: number;
    currency: string;
    meta: VerifiedTransaction["meta"];
  }>(`/transactions/${encodeURIComponent(transactionId)}/verify`);
  return {
    id: data.id,
    txRef: data.tx_ref,
    status: data.status as VerifiedTransaction["status"],
    amountLocalMinor: Math.round(data.amount * 100),
    currency: data.currency,
    meta: data.meta ?? null,
  };
}

/**
 * Webhook authenticity: Flutterwave sends your configured secret hash in the
 * `verif-hash` header verbatim. Constant-time compare.
 */
export function isAuthenticWebhook(headerHash: string | null): boolean {
  const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH;
  if (!expected || !headerHash) return false;
  return constantTimeEquals(expected, headerHash);
}

/**
 * Refund a settled transaction, in whole or in part.
 *
 * Flutterwave refunds by its own numeric transaction id and takes MAJOR units,
 * the same as its charge endpoint. The amount is the local-currency amount to
 * return, not the USD the ledger holds: the customer paid naira and gets naira
 * back, so converting here would refund whatever today's rate happens to be
 * rather than what they actually handed over.
 */
export async function refund(
  transactionId: string,
  amountLocalMinor: number,
): Promise<{ refundRef: string }> {
  if (!Number.isInteger(amountLocalMinor) || amountLocalMinor <= 0) {
    throw new Error("refund amount must be positive integer minor units");
  }
  const data = await fw<{ id: number | string }>(
    `/transactions/${encodeURIComponent(transactionId)}/refund`,
    {
      method: "POST",
      body: JSON.stringify({ amount: (amountLocalMinor / 100).toFixed(2) }),
    },
  );
  return { refundRef: String(data.id) };
}

export { usdCreditForVerified } from "./shared";
export type { CheckoutRequest, VerifiedTransaction } from "./shared";
