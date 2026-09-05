import { afterEach, describe, expect, it, vi } from "vitest";
import { activeProvider, isPspId, pspRef } from "./provider";

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
