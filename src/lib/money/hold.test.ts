import { describe, expect, it } from "vitest";
import { holdAmountUsdMinor, markupFeeUsdMinor } from "./hold";
import { heldForBudget, validateEntry, balance, type LedgerEntry } from "./ledger";

const at = (kind: LedgerEntry["kind"], amountUsdMinor: number): LedgerEntry => ({
  kind,
  amountUsdMinor,
  createdAt: new Date("2026-09-05T08:00:00Z"),
});

describe("markupFeeUsdMinor", () => {
  it("matches record_spend: the fee rounds UP", () => {
    // $10.00 at 15% = $1.50 exactly
    expect(markupFeeUsdMinor(1000, 1500)).toBe(150);
    // $10.01 at 15% = 150.15 -> 151, never 150
    expect(markupFeeUsdMinor(1001, 1500)).toBe(151);
  });

  it("is zero at zero markup", () => {
    expect(markupFeeUsdMinor(5000, 0)).toBe(0);
  });

  it("refuses a markup outside the range the database accepts", () => {
    expect(() => markupFeeUsdMinor(1000, 3001)).toThrow();
    expect(() => markupFeeUsdMinor(1000, -1)).toThrow();
  });
});

describe("holdAmountUsdMinor", () => {
  it("holds the budget plus its markup, not just the budget", () => {
    // A $10/day budget on Starter (15%) can take $11.50 from the wallet.
    expect(holdAmountUsdMinor(1000, 1500)).toBe(1150);
    // Scale (10%) on the same budget
    expect(holdAmountUsdMinor(1000, 1000)).toBe(1100);
  });

  it("never holds less than the eventual charge", () => {
    for (const budget of [1, 7, 333, 1001, 99_999]) {
      for (const bps of [0, 1000, 1200, 1500]) {
        expect(holdAmountUsdMinor(budget, bps)).toBeGreaterThanOrEqual(
          budget + markupFeeUsdMinor(budget, bps),
        );
      }
    }
  });

  it("rejects fractional or negative budgets", () => {
    expect(() => holdAmountUsdMinor(10.5, 1500)).toThrow();
    expect(() => holdAmountUsdMinor(-100, 1500)).toThrow();
  });
});

describe("budget_hold in the ledger", () => {
  it("is valid in both directions, because it is placed and released", () => {
    expect(() => validateEntry(at("budget_hold", -1150))).not.toThrow();
    expect(() => validateEntry(at("budget_hold", 1150))).not.toThrow();
  });

  it("reduces the spendable balance the moment it is placed", () => {
    const entries = [at("topup", 10_000), at("budget_hold", -1150)];
    expect(balance(entries)).toBe(8850);
    expect(heldForBudget(entries)).toBe(1150);
  });

  it("returns the money and shows nothing held once released", () => {
    const entries = [at("topup", 10_000), at("budget_hold", -1150), at("budget_hold", 1150)];
    expect(balance(entries)).toBe(10_000);
    expect(heldForBudget(entries)).toBe(0);
  });

  it("sums several open days rather than showing only the latest", () => {
    const entries = [at("topup", 10_000), at("budget_hold", -1150), at("budget_hold", -900)];
    expect(heldForBudget(entries)).toBe(2050);
    expect(balance(entries)).toBe(7950);
  });

  it("never reports a negative held amount if releases outnumber holds", () => {
    expect(heldForBudget([at("budget_hold", 500)])).toBe(0);
  });

  it("ignores entries that are not holds", () => {
    expect(heldForBudget([at("topup", 10_000), at("ad_spend", -500)])).toBe(0);
  });
});
