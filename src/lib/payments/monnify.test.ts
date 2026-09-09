import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  baseUrl,
  createCheckout,
  isAuthenticWebhook,
  isConfigured,
  refund,
  resetTokenCache,
  toMajorString,
  toMinor,
  verifyTransaction,
} from "./monnify";

const API_KEY = "MK_TEST_ABCDEF1234";
const SECRET = "monnify_test_secret";
const CONTRACT = "1234567890";

/**
 * Every Monnify call is preceded by a login, so the stub answers the auth
 * endpoint first and the requested payload for everything else. Returns the
 * captured calls so a test can assert on what actually went over the wire.
 */
function stubMonnify(payload: unknown, ok = true) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      if (url.includes("/api/v1/auth/login")) {
        return {
          json: async () => ({
            requestSuccessful: true,
            responseBody: { accessToken: "tok_123", expiresIn: 3600 },
          }),
        } as unknown as Response;
      }
      return {
        json: async () => ({
          requestSuccessful: ok,
          responseMessage: ok ? "success" : "Invalid contract code",
          responseBody: payload,
        }),
      } as unknown as Response;
    }),
  );
  return calls;
}

const CHECKOUT = {
  txRef: "glocal-abc",
  amountLocalMinor: 10_815_000, // ₦108,150.00
  currency: "NGN",
  customerEmail: "shop@example.com",
  customerName: "Ada Obi",
  redirectUrl: "https://useglocal.ai/wallet/confirm",
  meta: { business_id: "biz-1", usd_minor: 6500, fx_rate: 1663.85 },
};

beforeEach(() => {
  resetTokenCache();
  vi.stubEnv("MONNIFY_API_KEY", API_KEY);
  vi.stubEnv("MONNIFY_SECRET_KEY", SECRET);
  vi.stubEnv("MONNIFY_CONTRACT_CODE", CONTRACT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetTokenCache();
});

describe("amounts are MAJOR units — the hundredfold trap", () => {
  it("converts kobo to a two-decimal naira string on checkout", async () => {
    // Paystack takes minor units and this adapter must NOT copy that. Passing
    // 10,815,000 straight through would charge ₦10,815,000 for a ₦108,150 top-up.
    const calls = stubMonnify({ checkoutUrl: "https://sandbox.monnify.com/c/xyz" });
    await createCheckout(CHECKOUT);
    const init = calls.find((c) => c.url.includes("init-transaction"))!;
    expect((init.body as { amount: string }).amount).toBe("108150.00");
  });

  it("converts kobo to naira on refund too", async () => {
    const calls = stubMonnify({ refundReference: "rf-1" });
    await refund("MNFY|50|20250205174323|000010", 250_000); // ₦2,500.00
    const call = calls.find((c) => c.url.includes("initiate-refund"))!;
    expect((call.body as { amount: string }).amount).toBe("2500.00");
  });

  it("round-trips minor→major→minor without drift", () => {
    for (const minor of [1, 99, 100, 10_055, 10_815_000, 999_999_99]) {
      expect(toMinor(Number(toMajorString(minor)))).toBe(minor);
    }
  });

  it("scales a float amountPaid back to minor units without truncating", () => {
    // 100.55 * 100 is 10054.999... in IEEE754; a bare Math.floor loses a kobo.
    expect(toMinor(100.55)).toBe(10_055);
  });
});

describe("verifyTransaction", () => {
  it("normalises PAID to the codebase's 'successful' spelling", async () => {
    stubMonnify({
      transactionReference: "MNFY|50|20250205174323|000010",
      paymentReference: "glocal-abc",
      paymentStatus: "PAID",
      amountPaid: 108150.0,
      currencyCode: "NGN",
      metaData: {},
    });
    const txn = await verifyTransaction("MNFY|50|20250205174323|000010");
    expect(txn.status).toBe("successful");
    expect(txn.amountLocalMinor).toBe(10_815_000);
  });

  it("leaves a non-PAID status alone so settlement refuses it", async () => {
    stubMonnify({
      transactionReference: "MNFY|1",
      paymentReference: "x",
      paymentStatus: "PENDING",
      amountPaid: 0,
      currencyCode: "NGN",
      metaData: {},
    });
    expect((await verifyTransaction("MNFY|1")).status).toBe("PENDING");
  });

  it("URL-encodes the pipes in a Monnify reference", async () => {
    const calls = stubMonnify({
      transactionReference: "MNFY|50|1",
      paymentReference: "x",
      paymentStatus: "PAID",
      amountPaid: 1,
      currencyCode: "NGN",
      metaData: {},
    });
    await verifyTransaction("MNFY|50|1");
    const call = calls.find((c) => c.url.includes("/api/v2/transactions/"))!;
    expect(call.url).toContain("MNFY%7C50%7C1");
    expect(call.url).not.toContain("MNFY|50|1");
  });

  it("keeps the string reference as the id rather than coercing it to NaN", async () => {
    stubMonnify({
      transactionReference: "MNFY|50|20250205174323|000010",
      paymentReference: "x",
      paymentStatus: "PAID",
      amountPaid: 1,
      currencyCode: "NGN",
      metaData: {},
    });
    // Every Monnify charge would share one ledger key if this became NaN.
    expect((await verifyTransaction("MNFY|50|1")).id).toBe("MNFY|50|20250205174323|000010");
  });
});

describe("metaData crosses as strings and comes back as numbers", () => {
  it("stringifies numeric metadata on the way out", async () => {
    const calls = stubMonnify({ checkoutUrl: "https://x" });
    await createCheckout(CHECKOUT);
    const init = calls.find((c) => c.url.includes("init-transaction"))!;
    expect((init.body as { metaData: Record<string, string> }).metaData).toEqual({
      business_id: "biz-1",
      usd_minor: "6500",
      fx_rate: "1663.85",
    });
  });

  it("coerces them back so settlement computes a credit, not NaN", async () => {
    stubMonnify({
      transactionReference: "MNFY|1",
      paymentReference: "x",
      paymentStatus: "PAID",
      amountPaid: 1,
      currencyCode: "NGN",
      metaData: { business_id: "biz-1", usd_minor: "6500", fx_rate: "1663.85" },
    });
    const txn = await verifyTransaction("MNFY|1");
    expect(txn.meta).toEqual({ business_id: "biz-1", usd_minor: 6500, fx_rate: 1663.85 });
  });
});

describe("webhook authenticity", () => {
  const body = JSON.stringify({ eventType: "SUCCESSFUL_TRANSACTION", eventData: {} });
  const sign = (b: string, key = SECRET) =>
    createHmac("sha512", key).update(b, "utf8").digest("hex");

  it("accepts a signature made with the secret key over the raw body", () => {
    expect(isAuthenticWebhook(body, sign(body))).toBe(true);
  });

  it("rejects a body altered after signing", () => {
    expect(isAuthenticWebhook(body.replace("SUCCESSFUL", "FAILED"), sign(body))).toBe(false);
  });

  it("rejects a signature made with the wrong key", () => {
    expect(isAuthenticWebhook(body, sign(body, "someone_elses_secret"))).toBe(false);
  });

  it("rejects a missing signature rather than treating it as absent proof", () => {
    expect(isAuthenticWebhook(body, null)).toBe(false);
  });
});

describe("environment is derived from the key, not configured separately", () => {
  it("sends MK_TEST keys to sandbox", () => {
    expect(baseUrl()).toBe("https://sandbox.monnify.com");
  });

  it("sends MK_PROD keys to live", () => {
    vi.stubEnv("MONNIFY_API_KEY", "MK_PROD_ABCDEF1234");
    expect(baseUrl()).toBe("https://api.monnify.com");
  });
});

describe("isConfigured", () => {
  it("is false without a contract code, since checkout would always fail", () => {
    vi.stubEnv("MONNIFY_CONTRACT_CODE", "");
    expect(isConfigured()).toBe(false);
  });

  it("is true with all three values", () => {
    expect(isConfigured()).toBe(true);
  });
});

describe("envelope handling", () => {
  it("throws on requestSuccessful:false rather than returning a broken link", async () => {
    stubMonnify(null, false);
    await expect(createCheckout(CHECKOUT)).rejects.toThrow(/Invalid contract code/);
  });

  it("refuses a non-integer or non-positive amount before calling out", async () => {
    stubMonnify({ checkoutUrl: "https://x" });
    await expect(createCheckout({ ...CHECKOUT, amountLocalMinor: 0 })).rejects.toThrow(
      /positive integer minor units/,
    );
    await expect(createCheckout({ ...CHECKOUT, amountLocalMinor: 10.5 })).rejects.toThrow(
      /positive integer minor units/,
    );
  });
});

describe("auth token", () => {
  it("logs in with Basic base64(apiKey:secretKey) and reuses the token", async () => {
    const calls = stubMonnify({ checkoutUrl: "https://x" });
    await createCheckout(CHECKOUT);
    await createCheckout(CHECKOUT);
    const logins = calls.filter((c) => c.url.includes("/auth/login"));
    expect(logins).toHaveLength(1);
    const expected = Buffer.from(`${API_KEY}:${SECRET}`, "utf8").toString("base64");
    expect(logins[0].headers.Authorization).toBe(`Basic ${expected}`);
    const init = calls.find((c) => c.url.includes("init-transaction"))!;
    expect(init.headers.Authorization).toBe("Bearer tok_123");
  });
});
