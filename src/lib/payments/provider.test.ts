import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PSP_IDS,
  activeProvider,
  checkoutOrder,
  createCheckout,
  isPspId,
  parsePspRef,
  pspRef,
} from "./provider";

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

  it("falls to Monnify as the standby when Paystack has no key", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("MONNIFY_API_KEY", "MK_TEST_1");
    vi.stubEnv("MONNIFY_SECRET_KEY", "s");
    vi.stubEnv("MONNIFY_CONTRACT_CODE", "1234567890");
    // Monnify outranks Flutterwave: it can be switched on, Flutterwave cannot.
    expect(activeProvider()).toBe("monnify");
  });

  it("prefers Paystack when both are configured", () => {
    // Paystack is approved and can charge today; Flutterwave's live keys wait
    // on a CAC amendment. A rail that cannot be switched on is not a default.
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(activeProvider()).toBe("paystack");
  });

  it("still uses Flutterwave when it is the only rail with a key", () => {
    // Kept as a rail rather than deleted, so a pasted key is all it takes.
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(activeProvider()).toBe("flutterwave");
  });

  it("names the primary when neither is configured, so the error points at it", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(activeProvider()).toBe("paystack");
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

describe("pspRef / parsePspRef round-trip", () => {
  it("gives each rail its own prefix", () => {
    expect(pspRef("paystack", 123)).toBe("ps-123");
    expect(pspRef("flutterwave", 123)).toBe("flw-123");
    expect(pspRef("monnify", "MNFY|50|1")).toBe("mnfy-MNFY|50|1");
  });

  it("parses a Monnify reference back, pipes and all", () => {
    // The id must survive intact: it is what a refund is addressed to.
    expect(parsePspRef("mnfy-MNFY|50|20250205174323|000010")).toEqual({
      psp: "monnify",
      id: "MNFY|50|20250205174323|000010",
    });
  });

  it("still parses the historical prefixes unchanged", () => {
    expect(parsePspRef("flw-999")).toEqual({ psp: "flutterwave", id: "999" });
    expect(parsePspRef("ps-999")).toEqual({ psp: "paystack", id: "999" });
  });

  it("round-trips every rail", () => {
    for (const psp of PSP_IDS) {
      expect(parsePspRef(pspRef(psp, "abc|1"))).toEqual({ psp, id: "abc|1" });
    }
  });

  it("returns null on a reference from no known rail", () => {
    expect(parsePspRef("stripe-1")).toBeNull();
  });
});
