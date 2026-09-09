import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTokenCache as resetMonnifyTokenCache } from "./monnify";
import {
  CHECKOUT_RAILS,
  PSP_IDS,
  activeProvider,
  canOpenCheckout,
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
  it("obeys PAYMENTS_PROVIDER when it names a rail that may still charge", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "paystack");
    expect(activeProvider()).toBe("paystack");
    vi.stubEnv("PAYMENTS_PROVIDER", "monnify");
    expect(activeProvider()).toBe("monnify");
  });

  it("tolerates surrounding whitespace from a pasted env var", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "  paystack ");
    expect(activeProvider()).toBe("paystack");
  });

  it("throws on a typo rather than quietly charging on the other rail", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "paystak");
    expect(() => activeProvider()).toThrow(/paystack \| monnify/);
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

  it("does NOT use Flutterwave even when it is the only rail with a key", () => {
    // It is retired. A key lying around in the environment must not be enough
    // to put a customer back on it -- that is exactly how the incident
    // happened.
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("MONNIFY_API_KEY", "");
    expect(activeProvider()).toBe("paystack");
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
  it("accepts every known rail, retired ones included", () => {
    // isPspId gates ref parsing and settlement, not checkout, so Flutterwave
    // must stay valid here or old charges become unrefundable.
    expect(isPspId("flutterwave")).toBe(true);
    expect(isPspId("monnify")).toBe(true);
    expect(isPspId("paystack")).toBe(true);
    expect(isPspId("stripe")).toBe(false);
    expect(isPspId(null)).toBe(false);
    expect(isPspId(undefined)).toBe(false);
  });
});

describe("checkoutOrder", () => {
  beforeEach(() => {
    vi.stubEnv("MONNIFY_API_KEY", "MK_TEST_1");
    vi.stubEnv("MONNIFY_SECRET_KEY", "s");
    vi.stubEnv("MONNIFY_CONTRACT_CODE", "1234567890");
  });

  it("puts the preferred rail first and keeps the other as a standby", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "monnify");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(checkoutOrder()).toEqual(["monnify", "paystack"]);

    vi.stubEnv("PAYMENTS_PROVIDER", "paystack");
    expect(checkoutOrder()).toEqual(["paystack", "monnify"]);
  });

  it("leaves out a rail with no key, because it is not an option", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "monnify");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(checkoutOrder()).toEqual(["monnify"]);
  });

  it("is empty when nothing is configured, rather than offering a rail that cannot charge", () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("MONNIFY_API_KEY", "");
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
  function stubRails(failing: "monnify" | "paystack" | "both" | "none") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const isMnfy = String(url).includes("monnify");
        // Monnify trades for a token before it can do anything; that call is
        // not the rail failing, so it answers even when the rail is "down".
        if (isMnfy && String(url).includes("/auth/login")) {
          return {
            json: async () => ({
              requestSuccessful: true,
              responseBody: { accessToken: "tok", expiresIn: 3600 },
            }),
          } as unknown as Response;
        }
        const down =
          failing === "both" ||
          (failing === "monnify" && isMnfy) ||
          (failing === "paystack" && !isMnfy);
        if (down) throw new Error("network down");
        return {
          json: async () =>
            isMnfy
              ? {
                  requestSuccessful: true,
                  responseBody: { checkoutUrl: "https://monnify.test/pay" },
                }
              : { status: true, data: { authorization_url: "https://paystack.test/pay" } },
        } as unknown as Response;
      }),
    );
  }

  beforeEach(() => {
    resetMonnifyTokenCache();
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    vi.stubEnv("MONNIFY_API_KEY", "MK_TEST_1");
    vi.stubEnv("MONNIFY_SECRET_KEY", "s");
    vi.stubEnv("MONNIFY_CONTRACT_CODE", "1234567890");
    vi.stubEnv("PAYMENTS_PROVIDER", "paystack");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMonnifyTokenCache();
  });

  it("uses the preferred rail when it works", async () => {
    stubRails("none");
    await expect(createCheckout(req)).resolves.toEqual({
      link: "https://paystack.test/pay",
      psp: "paystack",
    });
  });

  it("hands the customer to Monnify when Paystack fails", async () => {
    // The whole point: the customer gets a working link, not an error.
    stubRails("paystack");
    await expect(createCheckout(req)).resolves.toEqual({
      link: "https://monnify.test/pay",
      psp: "monnify",
    });
  });

  it("fails over the other way too", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "monnify");
    stubRails("monnify");
    await expect(createCheckout(req)).resolves.toMatchObject({ psp: "paystack" });
  });

  it("does not fall back to a rail with no key", async () => {
    vi.stubEnv("MONNIFY_API_KEY", "");
    stubRails("paystack");
    await expect(createCheckout(req)).rejects.toThrow(/Every payment rail failed/);
  });

  it("never falls back to Flutterwave, even when both live rails are down", async () => {
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    stubRails("both");
    await expect(createCheckout(req)).rejects.toThrow(/Every payment rail failed/);
    await expect(createCheckout(req)).rejects.not.toThrow(/flutterwave/);
  });

  it("reports every rail it tried when they all fail", async () => {
    stubRails("both");
    await expect(createCheckout(req)).rejects.toThrow(
      /monnify.*paystack|paystack.*monnify/,
    );
  });

  it("says so plainly when nothing is configured at all", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("MONNIFY_API_KEY", "");
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

describe("Flutterwave is retired from checkout", () => {
  // This is the regression test for a real production incident: customers were
  // landing on a Flutterwave checkout page for weeks after Paystack was made
  // "primary", because PAYMENTS_PROVIDER=flutterwave in the hosting environment
  // outranked every default in the code.
  it("ignores PAYMENTS_PROVIDER=flutterwave instead of obeying it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("PAYMENTS_PROVIDER", "flutterwave");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(activeProvider()).toBe("paystack");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/retired rail/));
    warn.mockRestore();
  });

  it("never puts Flutterwave in the checkout order, even with a key", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("PAYMENTS_PROVIDER", "flutterwave");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_x");
    expect(checkoutOrder()).not.toContain("flutterwave");
  });

  it("does not fall back to Flutterwave when no other rail has a key", () => {
    // Better to fail loudly with "PAYSTACK_SECRET_KEY not configured" than to
    // quietly resurrect the retired rail.
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("MONNIFY_API_KEY", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    expect(activeProvider()).toBe("paystack");
    expect(checkoutOrder()).toEqual([]);
  });

  it("still knows Flutterwave as a rail for settling old charges", () => {
    // Retired means "takes no new money", not "forgotten": historical charges
    // must still verify and refund for years.
    expect(PSP_IDS).toContain("flutterwave");
    expect(parsePspRef("flw-12345")).toEqual({ psp: "flutterwave", id: "12345" });
    expect(canOpenCheckout("flutterwave")).toBe(false);
    expect(CHECKOUT_RAILS).toEqual(["paystack", "monnify"]);
  });
});
