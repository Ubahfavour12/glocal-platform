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
 */

const API = "https://api.flutterwave.com/v3";

function secretKey(): string {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) throw new Error("FLUTTERWAVE_SECRET_KEY not configured");
  return key;
}

async function fw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
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

export interface CheckoutRequest {
  txRef: string;
  amountLocalMinor: number;
  currency: string; // e.g. NGN
  customerEmail: string;
  customerName: string;
  redirectUrl: string;
  /** carried through to verification for the USD credit computation */
  meta: { business_id: string; usd_minor: number; fx_rate: number };
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
      customizations: { title: "Wallet top-up" },
    }),
  });
}

export interface VerifiedTransaction {
  id: number;
  txRef: string;
  status: "successful" | "failed" | string;
  amountLocalMinor: number;
  currency: string;
  meta: { business_id?: string; usd_minor?: number; fx_rate?: number } | null;
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
  if (headerHash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= headerHash.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * USD minor units to credit for a verified local payment, floor-rounded so
 * the ledger never over-credits (mirrors fx.usdCreditForLocal).
 */
export function usdCreditForVerified(
  amountLocalMinor: number,
  fxRate: number, // buffered local-per-USD rate quoted at checkout
): number {
  if (!(fxRate > 0)) throw new Error("fx rate must be positive");
  return Math.floor(amountLocalMinor / fxRate);
}
