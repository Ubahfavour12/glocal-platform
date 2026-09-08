import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  createCheckout,
  isAuthenticWebhook,
  isConfigured,
  refund,
  usdCreditForVerified,
  verifyTransaction,
} from "./paystack";

const KEY = "sk_test_paystack_secret";

/** Capture what we sent Paystack, and reply with a canned envelope. */
function stubPaystack(payload: unknown, ok = true) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return {
        json: async () => ({ status: ok, message: ok ? "ok" : "Invalid key", data: payload }),
      } as unknown as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("PAYSTACK_SECRET_KEY", KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createCheckout — amounts stay in minor units", () => {
  it("sends kobo straight through, NOT converted to major units", async () => {
    // The Flutterwave adapter divides by 100 here because its API takes major
    // units. Doing that for Paystack would charge ₦1,081.50 for a ₦108,150
    // top-up, so this is the test that stops the two rails being confused.
    const calls = stubPaystack({ authorization_url: "https://checkout.paystack.com/abc" });

    const { link } = await createCheckout({
      txRef: "topup-abcd1234-1700000000000",
      amountLocalMinor: 10_815_000,
      currency: "NGN",
      customerEmail: "owner@shop.ng",
      customerName: "Gormup Gates",
      redirectUrl: "https://app.test/api/wallet/confirm",
      meta: { business_id: "b-1", usd_minor: 7000, fx_rate: 1545 },
    });

    expect(link).toBe("https://checkout.paystack.com/abc");
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/initialize");
    expect(calls[0].body).toMatchObject({
      amount: 10_815_000,
      currency: "NGN",
      reference: "topup-abcd1234-1700000000000",
      email: "owner@shop.ng",
      callback_url: "https://app.test/api/wallet/confirm",
    });
  });

  it("carries the charge metadata the webhook needs to classify it", async () => {
    const calls = stubPaystack({ authorization_url: "https://checkout.paystack.com/x" });
    await createCheckout({
      txRef: "sub-abcd1234-1",
      amountLocalMinor: 1000,
      currency: "NGN",
      customerEmail: "a@b.ng",
      customerName: "Shop",
      redirectUrl: "https://app.test/upgrade",
      title: "Glocal subscription",
      meta: { business_id: "b-9", purpose: "subscription", tier: "growth", fx_rate: 1545 },
    });
    expect((calls[0].body as { metadata: Record<string, unknown> }).metadata).toMatchObject({
      business_id: "b-9",
      purpose: "subscription",
      tier: "growth",
      fx_rate: 1545,
    });
  });

  it("refuses a non-positive or fractional amount", async () => {
    stubPaystack({ authorization_url: "x" });
    const base = {
      txRef: "t",
      currency: "NGN",
      customerEmail: "a@b.ng",
      customerName: "S",
      redirectUrl: "https://app.test",
      meta: { business_id: "b-1" },
    };
    await expect(createCheckout({ ...base, amountLocalMinor: 0 })).rejects.toThrow();
    await expect(createCheckout({ ...base, amountLocalMinor: -100 })).rejects.toThrow();
    await expect(createCheckout({ ...base, amountLocalMinor: 10.5 })).rejects.toThrow();
  });

  it("throws with Paystack's message when the envelope flag is not true", async () => {
    stubPaystack(null, false);
    await expect(
      createCheckout({
        txRef: "t",
        amountLocalMinor: 1000,
        currency: "NGN",
        customerEmail: "a@b.ng",
        customerName: "S",
        redirectUrl: "https://app.test",
        meta: { business_id: "b-1" },
      }),
    ).rejects.toThrow(/Invalid key/);
  });

  it("refuses to call the API at all without a secret key", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const calls = stubPaystack({ authorization_url: "x" });
    await expect(
      createCheckout({
        txRef: "t",
        amountLocalMinor: 1000,
        currency: "NGN",
        customerEmail: "a@b.ng",
        customerName: "S",
        redirectUrl: "https://app.test",
        meta: { business_id: "b-1" },
      }),
    ).rejects.toThrow(/PAYSTACK_SECRET_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe("verifyTransaction — normalised for the rest of the codebase", () => {
  const verified = {
    id: 302961,
    reference: "topup-abcd1234-1700000000000",
    status: "success",
    amount: 10_815_000,
    currency: "NGN",
    metadata: { business_id: "b-1", usd_minor: 7000, fx_rate: 1545 },
  };

  it("translates Paystack's 'success' into the codebase's 'successful'", async () => {
    stubPaystack(verified);
    const txn = await verifyTransaction("topup-abcd1234-1700000000000");
    // Every existing caller tests `status !== "successful"`. Were this left as
    // "success", a genuinely paid charge would be silently dropped.
    expect(txn.status).toBe("successful");
  });

  it("leaves a failed status alone", async () => {
    stubPaystack({ ...verified, status: "failed" });
    expect((await verifyTransaction("r")).status).toBe("failed");
  });

  it("reads the amount as minor units without rescaling", async () => {
    stubPaystack(verified);
    const txn = await verifyTransaction("r");
    expect(txn.amountLocalMinor).toBe(10_815_000);
    expect(usdCreditForVerified(txn.amountLocalMinor, 1545)).toBe(7000);
  });

  it("parses metadata that comes back as a JSON string", async () => {
    stubPaystack({ ...verified, metadata: JSON.stringify(verified.metadata) });
    expect((await verifyTransaction("r")).meta).toMatchObject({ business_id: "b-1", fx_rate: 1545 });
  });

  it("treats unparseable or absent metadata as none, rather than throwing", async () => {
    stubPaystack({ ...verified, metadata: "{not json" });
    expect((await verifyTransaction("r")).meta).toBeNull();
    stubPaystack({ ...verified, metadata: null });
    expect((await verifyTransaction("r")).meta).toBeNull();
  });

  it("verifies by reference, url-encoded", async () => {
    const calls = stubPaystack(verified);
    await verifyTransaction("ref with/slash");
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/verify/ref%20with%2Fslash");
  });
});

describe("isAuthenticWebhook — HMAC of the raw body", () => {
  const raw = JSON.stringify({ event: "charge.success", data: { reference: "r-1" } });
  const sign = (body: string, key = KEY) =>
    createHmac("sha512", key).update(body, "utf8").digest("hex");

  it("accepts a signature computed over exactly these bytes", () => {
    expect(isAuthenticWebhook(raw, sign(raw))).toBe(true);
  });

  it("rejects a signature for a different body", () => {
    expect(isAuthenticWebhook(raw, sign(raw + " "))).toBe(false);
  });

  it("rejects a signature made with a different key", () => {
    expect(isAuthenticWebhook(raw, sign(raw, "sk_test_someone_else"))).toBe(false);
  });

  it("rejects a re-serialised body, which is why the route must not parse first", () => {
    // Same data, different bytes: JSON.parse→JSON.stringify reorders and
    // reformats. The signature is over the wire bytes, not the meaning.
    const reserialised = JSON.stringify({ data: { reference: "r-1" }, event: "charge.success" });
    expect(isAuthenticWebhook(reserialised, sign(raw))).toBe(false);
  });

  it("rejects a missing signature, and everything when no key is configured", () => {
    expect(isAuthenticWebhook(raw, null)).toBe(false);
    expect(isAuthenticWebhook(raw, "")).toBe(false);
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(isAuthenticWebhook(raw, sign(raw))).toBe(false);
  });
});

describe("isConfigured", () => {
  it("reports whether the rail can charge", () => {
    expect(isConfigured()).toBe(true);
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(isConfigured()).toBe(false);
  });
});

describe("refund — minor units, unlike Flutterwave", () => {
  it("sends kobo straight through, and refunds by reference", async () => {
    const calls = stubPaystack({ id: 7788 });
    const { refundRef } = await refund("topup-abcd1234-1", 10_815_000);
    expect(calls[0].url).toBe("https://api.paystack.co/refund");
    // Dividing by 100 here, as the Flutterwave adapter must, would refund a
    // hundredth of what the customer is owed.
    expect(calls[0].body).toEqual({ transaction: "topup-abcd1234-1", amount: 10_815_000 });
    expect(refundRef).toBe("7788");
  });

  it("refuses a non-positive or fractional amount", async () => {
    stubPaystack({ id: 1 });
    await expect(refund("r", 0)).rejects.toThrow();
    await expect(refund("r", -100)).rejects.toThrow();
    await expect(refund("r", 10.5)).rejects.toThrow();
  });
});
