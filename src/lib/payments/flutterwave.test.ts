import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthenticWebhook, refund, usdCreditForVerified } from "./flutterwave";

describe("usdCreditForVerified — never over-credits", () => {
  it("floors the USD credit at the quoted rate", () => {
    // ₦108,150.00 verified at quoted rate 1545 → $70.00 exactly
    expect(usdCreditForVerified(10_815_000, 1545)).toBe(7000);
    // one kobo less can only round DOWN
    expect(usdCreditForVerified(10_814_999, 1545)).toBe(6999);
  });

  it("rejects non-positive rates", () => {
    expect(() => usdCreditForVerified(1000, 0)).toThrow();
    expect(() => usdCreditForVerified(1000, -5)).toThrow();
  });
});

describe("isAuthenticWebhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the exact configured hash", () => {
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_HASH", "my-secret-hash-123");
    expect(isAuthenticWebhook("my-secret-hash-123")).toBe(true);
    expect(isAuthenticWebhook("my-secret-hash-124")).toBe(false);
    expect(isAuthenticWebhook("")).toBe(false);
    expect(isAuthenticWebhook(null)).toBe(false);
  });

  it("rejects everything when no hash is configured", () => {
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_HASH", "");
    expect(isAuthenticWebhook("anything")).toBe(false);
  });
});

describe("refund — major units, like its charge endpoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stub() {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse((init?.body as string) ?? "{}") });
        return { json: async () => ({ status: "success", data: { id: 55123 } }) } as unknown as Response;
      }),
    );
    return calls;
  }

  it("sends major units and refunds by numeric transaction id", async () => {
    const calls = stub();
    const { refundRef } = await refund("302961", 10_815_000);
    expect(calls[0].url).toBe("https://api.flutterwave.com/v3/transactions/302961/refund");
    // ₦108,150.00 as major units. Sending minor here would refund 100x.
    expect(calls[0].body).toEqual({ amount: "108150.00" });
    expect(refundRef).toBe("55123");
  });

  it("refuses a non-positive or fractional amount", async () => {
    stub();
    await expect(refund("302961", 0)).rejects.toThrow();
    await expect(refund("302961", -100)).rejects.toThrow();
    await expect(refund("302961", 10.5)).rejects.toThrow();
  });
});
