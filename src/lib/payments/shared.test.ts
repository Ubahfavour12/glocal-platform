import { describe, expect, it } from "vitest";
import { feeUsdMinor, parseMeta, usdCreditForVerified } from "./shared";

describe("usdCreditForVerified", () => {
  it("floors, so the ledger never over-credits", () => {
    expect(usdCreditForVerified(1500, 1000)).toBe(1);
  });

  it("refuses a rate it cannot divide by", () => {
    expect(() => usdCreditForVerified(1000, 0)).toThrow();
  });
});

describe("feeUsdMinor", () => {
  it("converts the processor's cut at the quoted rate", () => {
    // Paystack keeps 1.5% + N100 on a N100,000 charge = N1,600, which at a
    // 1,389 rate is about $1.16.
    expect(feeUsdMinor(160_000, 1389)).toBe(116);
  });

  it("rounds a cost UP where the credit rounds down", () => {
    // usdCreditForVerified floors so the ledger never over-credits a
    // customer; a cost ceilings so the margin is never flattered. Both round
    // against us, which is the only consistent rule.
    expect(usdCreditForVerified(1500, 1000)).toBe(1);
    expect(feeUsdMinor(1500, 1000)).toBe(2);
  });

  it("distinguishes 'no fee reported' from 'the fee was nothing'", () => {
    // THE DISTINCTION THAT KEEPS A COST VISIBLE. A rail that does not report
    // its fee records nothing, so the gap stays findable. Writing it as zero
    // would read as "this rail is free" forever -- which is exactly how the
    // fee went unmeasured in the first place.
    expect(feeUsdMinor(undefined, 1389)).toBeNull();
    expect(feeUsdMinor(0, 1389)).toBe(0);
  });

  it("refuses to convert without a usable rate", () => {
    expect(feeUsdMinor(1000, 0)).toBeNull();
    expect(feeUsdMinor(1000, Number.NaN)).toBeNull();
  });

  it("treats a nonsense fee as nothing rather than as a credit", () => {
    expect(feeUsdMinor(Number.NaN, 1389)).toBeNull();
    expect(feeUsdMinor(-500, 1389)).toBe(0);
  });
});

describe("parseMeta", () => {
  it("accepts metadata echoed as a JSON string", () => {
    // Paystack returns a string for charges started outside our checkout.
    expect(parseMeta('{"business_id":"b1"}')).toEqual({ business_id: "b1" });
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(parseMeta("not json")).toBeNull();
    expect(parseMeta(null)).toBeNull();
  });
});
