/**
 * Monnify integration — the standby money rail behind Paystack.
 *
 * Monnify is here for one reason: it fails independently. Paystack is owned by
 * Stripe; Monnify is a Moniepoint company settling through its own bank rails.
 * A standby that shares a parent with the primary is not a standby, it is the
 * same outage twice.
 *
 * Shape matches `paystack.ts` and `flutterwave.ts` exactly — quote USD→NGN at
 * the buffered rate → hosted checkout → customer pays on Monnify's page →
 * redirect back → VERIFY against Monnify's API (never trust the redirect or a
 * webhook body) → credit idempotently via record_psp_topup.
 *
 * Six places where Monnify is not Paystack. Each one silently corrupts money
 * if you assume otherwise, so each is asserted in monnify.test.ts:
 *
 *  1. Amounts are MAJOR units (naira, two decimal places), like Flutterwave
 *     and unlike Paystack. Passing our minor units straight through would
 *     charge a customer one hundred times the price.
 *  2. Every call needs a Bearer token first, fetched with Basic auth. Paystack
 *     takes the secret key directly; Monnify makes you trade it for a token
 *     that expires (~1h).
 *  3. The envelope's success flag is `requestSuccessful`, and the payload is
 *     under `responseBody` — not `status` / `data`.
 *  4. A settled charge reads "PAID", not "success" or "successful".
 *  5. The transaction reference is a STRING containing pipes
 *     ("MNFY|50|20250205174323|000010"), not a number. It must be URL-encoded
 *     on the way into a verify call.
 *  6. metaData values must be strings. Our fx_rate and usd_minor are numbers,
 *     so they are stringified on the way out and coerced back on the way in —
 *     otherwise settlement would compute a credit from "1750" as text.
 *
 * The environment is chosen by the KEY, not by a separate setting: Monnify
 * issues MK_TEST_* for sandbox and MK_PROD_* for live. Deriving the base URL
 * from the prefix makes "live key pointed at sandbox" unrepresentable, which
 * is the mistake that would otherwise take real money to a test ledger.
 */

import {
  constantTimeEquals,
  hmacSha512Hex,
  type ChargeMeta,
  type CheckoutRequest,
  type VerifiedTransaction,
} from "./shared";

const SANDBOX = "https://sandbox.monnify.com";
const LIVE = "https://api.monnify.com";

function apiKey(): string {
  const key = process.env.MONNIFY_API_KEY;
  if (!key) throw new Error("MONNIFY_API_KEY not configured");
  return key;
}

function secretKey(): string {
  const key = process.env.MONNIFY_SECRET_KEY;
  if (!key) throw new Error("MONNIFY_SECRET_KEY not configured");
  return key;
}

function contractCode(): string {
  const code = process.env.MONNIFY_CONTRACT_CODE;
  if (!code) throw new Error("MONNIFY_CONTRACT_CODE not configured");
  return code;
}

/**
 * Sandbox or live, decided by the key itself. See note in the file header:
 * an MK_PROD_ key can never be pointed at the sandbox by misconfiguration,
 * because there is no configuration to get wrong.
 */
export function baseUrl(): string {
  return apiKey().trim().startsWith("MK_PROD") ? LIVE : SANDBOX;
}

/**
 * Is this rail configured at all? All three values are required: a key without
 * a contract code cannot initialise a transaction, so reporting "configured"
 * would make the failover pick a rail that always fails.
 */
export function isConfigured(): boolean {
  return Boolean(
    process.env.MONNIFY_API_KEY &&
      process.env.MONNIFY_SECRET_KEY &&
      process.env.MONNIFY_CONTRACT_CODE,
  );
}

/**
 * Access tokens live ~1h. Caching one per warm instance avoids a login round
 * trip on every charge; `inFlight` collapses concurrent misses into a single
 * login rather than a burst of them.
 *
 * Expiry is held 60s early so a token can never be spent in the moment between
 * passing this check and arriving at Monnify.
 */
let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/** Testing seam — clears the cached token so a test cannot leak into the next. */
export function resetTokenCache(): void {
  cached = null;
  inFlight = null;
}

async function login(): Promise<string> {
  const basic = Buffer.from(`${apiKey()}:${secretKey()}`, "utf8").toString("base64");
  const res = await fetch(`${baseUrl()}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json()) as {
    requestSuccessful?: boolean;
    responseMessage?: string;
    responseBody?: { accessToken?: string; expiresIn?: number };
  };
  if (data.requestSuccessful !== true || !data.responseBody?.accessToken) {
    throw new Error(`Monnify auth: ${data.responseMessage ?? "login failed"}`);
  }
  const ttl = data.responseBody.expiresIn ?? 3600;
  cached = {
    token: data.responseBody.accessToken,
    expiresAt: Date.now() + Math.max(0, ttl - 60) * 1000,
  };
  return cached.token;
}

async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!inFlight) {
    inFlight = login().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function mnfy<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await res.json()) as {
    requestSuccessful?: boolean;
    responseMessage?: string;
    responseBody?: unknown;
  };
  // Strict `!== true`, as on Paystack: a truthy non-boolean here would mean we
  // are reading a response shape we do not understand, which is exactly when
  // guessing is most expensive.
  if (data.requestSuccessful !== true) {
    throw new Error(`Monnify ${path}: ${data.responseMessage ?? "request failed"}`);
  }
  return data.responseBody as T;
}

/** Minor units (kobo) → the major-unit string Monnify expects ("100.55"). */
export function toMajorString(amountLocalMinor: number): string {
  return (amountLocalMinor / 100).toFixed(2);
}

/**
 * Major units back to minor. Monnify returns amountPaid as a JSON number, so
 * 100.55 arrives as a float; rounding after scaling avoids the 10054.999…
 * that a bare truncation would produce.
 */
export function toMinor(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

/** metaData values must be strings on the way out (note 6). */
function stringifyMeta(meta: ChargeMeta): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

/**
 * …and numbers again on the way back, so settlement sees the same shape from
 * every rail. Only the two fields the ledger does arithmetic on are coerced;
 * anything unparseable is left out rather than becoming NaN, which settlement
 * already treats as "no rate" and refuses to credit on.
 */
function parseMonnifyMeta(raw: unknown): ChargeMeta | null {
  if (raw == null || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: ChargeMeta = {};
  if (typeof src.business_id === "string") out.business_id = src.business_id;
  if (typeof src.purpose === "string") out.purpose = src.purpose;
  if (typeof src.tier === "string") out.tier = src.tier;
  const usd = Number(src.usd_minor);
  if (src.usd_minor != null && Number.isFinite(usd)) out.usd_minor = usd;
  const fx = Number(src.fx_rate);
  if (src.fx_rate != null && Number.isFinite(fx)) out.fx_rate = fx;
  return out;
}

/** Create a hosted checkout page; returns the URL to send the customer to. */
export async function createCheckout(req: CheckoutRequest): Promise<{ link: string }> {
  if (!Number.isInteger(req.amountLocalMinor) || req.amountLocalMinor <= 0) {
    throw new Error("amount must be positive integer minor units");
  }
  const data = await mnfy<{ checkoutUrl: string; transactionReference: string }>(
    "/api/v1/merchant/transactions/init-transaction",
    {
      method: "POST",
      body: JSON.stringify({
        paymentReference: req.txRef,
        // MAJOR units. See note 1 in the file header.
        amount: toMajorString(req.amountLocalMinor),
        currencyCode: req.currency,
        contractCode: contractCode(),
        customerName: req.customerName,
        customerEmail: req.customerEmail,
        // Monnify rejects a description shorter than 3 characters.
        paymentDescription: req.title ?? "Wallet top-up",
        redirectUrl: req.redirectUrl,
        metaData: stringifyMeta(req.meta),
      }),
    },
  );
  return { link: data.checkoutUrl };
}

/**
 * Verify a transaction by Monnify's own transactionReference.
 *
 * The reference contains pipes, so it must be encoded — an unencoded one
 * produces a 404 that looks indistinguishable from "no such payment".
 */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const data = await mnfy<{
    transactionReference: string;
    paymentReference: string;
    paymentStatus: string;
    amountPaid: number | string;
    currencyCode: string;
    metaData: unknown;
  }>(`/api/v2/transactions/${encodeURIComponent(reference)}`);
  return {
    id: data.transactionReference,
    txRef: data.paymentReference,
    // Normalised to the rest of the codebase's spelling. See note 4.
    status: data.paymentStatus === "PAID" ? "successful" : data.paymentStatus,
    amountLocalMinor: toMinor(Number(data.amountPaid)),
    currency: data.currencyCode,
    meta: parseMonnifyMeta(data.metaData),
  };
}

/**
 * Webhook authenticity: `monnify-signature` is HMAC-SHA512 of the exact bytes
 * Monnify sent, keyed on the secret key. Same algorithm as Paystack, different
 * header — so like Paystack there is no separate hash to configure and nothing
 * to leave empty by accident.
 */
export function isAuthenticWebhook(rawBody: string, signature: string | null): boolean {
  const key = process.env.MONNIFY_SECRET_KEY;
  if (!key || !signature) return false;
  return constantTimeEquals(hmacSha512Hex(key, rawBody), signature);
}

/**
 * Refund a settled transaction, in whole or in part.
 *
 * MAJOR units, the same asymmetry as the charge endpoint (note 1): sending our
 * minor units here would try to refund a hundred times what was paid.
 *
 * `customerNote` is capped at 16 characters by Monnify and the whole refund is
 * rejected if it is longer, so it is a fixed short string rather than anything
 * derived from a name or description.
 */
export async function refund(
  reference: string,
  amountLocalMinor: number,
): Promise<{ refundRef: string }> {
  if (!Number.isInteger(amountLocalMinor) || amountLocalMinor <= 0) {
    throw new Error("refund amount must be positive integer minor units");
  }
  const refundReference = `rf-${reference}`;
  const data = await mnfy<{ refundReference?: string }>("/api/v1/refunds/initiate-refund", {
    method: "POST",
    body: JSON.stringify({
      transactionReference: reference,
      refundReference,
      amount: toMajorString(amountLocalMinor),
      currencyCode: "NGN",
      contractCode: contractCode(),
      refundReason: "Customer wallet withdrawal",
      customerNote: "Wallet payout", // <= 16 chars
    }),
  });
  return { refundRef: data.refundReference ?? refundReference };
}

export { usdCreditForVerified } from "./shared";
export type { CheckoutRequest, VerifiedTransaction } from "./shared";
