import { describe, expect, it } from "vitest";
import { classifyCharge, subscriptionPriceUsdMinor, subscriptionTxRef } from "./subscribe";

describe("subscriptionPriceUsdMinor", () => {
  it("returns each tier's monthly price in minor units", () => {
    expect(subscriptionPriceUsdMinor("starter")).toBe(3900);
    expect(subscriptionPriceUsdMinor("growth")).toBe(9900);
    expect(subscriptionPriceUsdMinor("scale")).toBe(24900);
  });
});

describe("classifyCharge", () => {
  it("recognises a subscription charge with a valid tier", () => {
    expect(classifyCharge({ business_id: "b1", purpose: "subscription", tier: "growth" })).toEqual({
      kind: "subscription",
      tier: "growth",
    });
  });

  it("treats a business charge without a subscription purpose as a top-up", () => {
    expect(classifyCharge({ business_id: "b1" })).toEqual({ kind: "topup" });
    expect(classifyCharge({ business_id: "b1", purpose: "other" })).toEqual({ kind: "topup" });
  });

  it("ignores charges with no business or an invalid tier", () => {
    expect(classifyCharge(null)).toEqual({ kind: "ignore" });
    expect(classifyCharge({})).toEqual({ kind: "ignore" });
    expect(classifyCharge({ business_id: "b1", purpose: "subscription", tier: "bogus" })).toEqual({
      kind: "ignore",
    });
    expect(classifyCharge({ business_id: "b1", purpose: "subscription" })).toEqual({ kind: "ignore" });
  });
});

describe("subscriptionTxRef", () => {
  it("is prefixed and business-scoped", () => {
    const ref = subscriptionTxRef("abcdef12-3456-7890");
    expect(ref.startsWith("sub-abcdef12-")).toBe(true);
  });
});
