import { describe, expect, it } from "vitest";
import { affordableAdSpendMinor, markupFeeMinor, totalWalletDebitMinor } from "./markup";

describe("markupFeeMinor", () => {
  it("computes the fee from basis points (matches the ledger)", () => {
    expect(markupFeeMinor(1000, 1500)).toBe(150); // $10 spend @ 15% = $1.50
    expect(markupFeeMinor(1000, 1200)).toBe(120); // 12%
    expect(markupFeeMinor(1000, 1000)).toBe(100); // 10%
  });
  it("is zero for non-positive spend or bps", () => {
    expect(markupFeeMinor(0, 1500)).toBe(0);
    expect(markupFeeMinor(1000, 0)).toBe(0);
    expect(markupFeeMinor(-500, 1500)).toBe(0);
  });
});

describe("totalWalletDebitMinor", () => {
  it("is spend plus its markup", () => {
    expect(totalWalletDebitMinor(1000, 1500)).toBe(1150); // $11.50 to run $10 of ads
  });
});

describe("affordableAdSpendMinor", () => {
  it("caps spend so spend + markup fits the budget", () => {
    // $100 budget @ 12% -> ~$89.29 reaches ads; $89.29 * 1.12 <= $100
    expect(affordableAdSpendMinor(10_000, 1200)).toBe(8928);
    expect(totalWalletDebitMinor(8928, 1200)).toBeLessThanOrEqual(10_000);
  });
  it("no markup -> full budget; zero budget -> zero", () => {
    expect(affordableAdSpendMinor(10_000, 0)).toBe(10_000);
    expect(affordableAdSpendMinor(0, 1500)).toBe(0);
  });
});
