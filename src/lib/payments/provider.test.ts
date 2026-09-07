import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeProvider, checkoutOrder, createCheckout, isPspId, pspRef } from "./provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("activeProvider", () => {
  it("obeys PAYMENTS_PROVIDER when it names a real rail", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "paystack");
    expect(activeProvider()).toBe("paystack");
    vi.stubEnv("PAYMENTS_PROVIDER", "flutterwave");
    expect(activeProvider()).toBe("flutterwave");
  });

  it("tolerates surrounding whitespace from a pasted env var", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "  paystack ");
    expect(activeProvider()).toBe("paystack");
  });

  it("throws on a typo rather than quietly charging on the other rail", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "paystak");
    expect(() => activeProvider()).toThrow(/flutterwave \| paystack/);
  });

  it("prefers a rail that actually has keys when unset", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(activeProvider()).toBe("paystack");
  });

  it("keeps Flutterwave the default when both are configured", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(activeProvider()).toBe("flutterwave");
  });

  it("falls back to Flutterwave when neither is configured, for a familiar error", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(activeProvider()).toBe("flutterwave");
  });
});

describe("pspRef — the ledger's idempotency key", () => {
  it("keeps the historical flw- prefix untouched", () => {
    // Ledger entries written before Paystack existed use this exact shape.
    // Changing it would let an old charge credit a second time.
    expect(pspRef("flutterwave", 302961)).toBe("flw-302961");
  });

  it("gives Paystack its own prefix, so ids cannot collide across rails", () => {
    expect(pspRef("paystack", 302961)).toBe("ps-302961");
    expect(pspRef("paystack", 302961)).not.toBe(pspRef("flutterwave", 302961));
  });

  it("is stable for the same charge, which is what makes double settlement safe", () => {
    // The redirect and the webhook both settle; both must produce this.
    expect(pspRef("paystack", "302961")).toBe(pspRef("paystack", 302961));
  });
});

describe("isPspId", () => {
  it("accepts only the two rails", () => {
    expect(isPspId("flutterwave")).toBe(true);
    expect(isPspId("paystack")).toBe(true);
    expect(isPspId("stripe")).toBe(false);
    expect(isPspId(null)).toBe(false);
    expect(isPspId(undefined)).toBe(false);
  });
});

describe("checkoutOrder", () => {
  it("puts the preferred rail first and keeps the other as a standby", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "flutterwave");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(checkoutOrder()).toEqual(["flutterwave", "paystack"]);

    vi.stubEnv("PAYMENTS_PROVIDER", "paystack");
    expect(checkoutOrder()).toEqual(["paystack", "flutterwave"]);
  });

  it("leaves out a rail with no key, because it is not an option", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "flutterwave");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(checkoutOrder()).toEqual(["flutterwave"]);
  });

  it("is empty when nothing is configured, rather than offering a rail that cannot charge", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(checkoutOrder()).toEqual([]);
  });
});

describe("createCheckout — failover", () => {
  const req = {
    txRef: "topup-abcd1234-1",
    amountLocalMinor: 10_000,
    currency: "NGN",
    customerEmail: "owner@shop.ng",
    customerName: "Gormup Gates",
    redirectUrl: "https://app.test/api/wallet/confirm",
    meta: { business_id: "b-1", usd_minor: 700, fx_rate: 1545 },
  };

  /** Fail the named rail's API; let the other one answer. */
  function stubRails(failing: "flutterwave" | "paystack" | "both" | "none") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const isFlw = String(url).includes("flutterwave");
        const down =
          failing === "both" || (failing === "flutterwave" && isFlw) || (failing === "paystack" && !isFlw);
        if (down) throw new Error("network down");
        return {
          json: async () =>
            isFlw
              ? { status: "success", data: { link: "https://flutterwave.test/pay" } }
              : { status: true, data: { authorization_url: "https://paystack.test/pay" } },
        } as unknown as Response;
      }),
    );
  }

  beforeEach(() => {
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    vi.stubEnv("PAYMENTS_PROVIDER", "flutterwave");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the preferred rail when it works", async () => {
    stubRails("none");
    await expect(createCheckout(req)).resolves.toEqual({
      link: "https://flutterwave.test/pay",
      psp: "flutterwave",
    });
  });

  it("hands the customer to Paystack when Flutterwave fails", async () => {
    // The whole point: the customer gets a working link, not an error.
    stubRails("flutterwave");
    await expect(createCheckout(req)).resolves.toEqual({
      link: "https://paystack.test/pay",
      psp: "paystack",
    });
  });

  it("fails over the other way too", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "paystack");
    stubRails("paystack");
    await expect(createCheckout(req)).resolves.toMatchObject({ psp: "flutterwave" });
  });

  it("does not fall back to a rail with no key", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    stubRails("flutterwave");
    await expect(createCheckout(req)).rejects.toThrow(/Every payment rail failed/);
  });

  it("reports every rail it tried when they all fail", async () => {
    stubRails("both");
    await expect(createCheckout(req)).rejects.toThrow(/flutterwave.*paystack|paystack.*flutterwave/);
  });

  it("says so plainly when nothing is configured at all", async () => {
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    stubRails("none");
    await expect(createCheckout(req)).rejects.toThrow(/No payment rail is configured/);
  });
});
