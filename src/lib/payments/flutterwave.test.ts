import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthenticWebhook, usdCreditForVerified } from "./flutterwave";

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
