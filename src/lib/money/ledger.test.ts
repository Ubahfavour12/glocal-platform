import { describe, expect, it } from "vitest";
import {
  balance,
  canDebit,
  minFirstDepositUsdMinor,
  refundable,
  runwayDays,
  validateEntry,
  type LedgerEntry,
} from "./ledger";

const d = new Date("2026-07-10T00:00:00Z");
const entry = (kind: LedgerEntry["kind"], amountUsdMinor: number): LedgerEntry => ({
  kind,
  amountUsdMinor,
  createdAt: d,
});

describe("validateEntry", () => {
  it("accepts credits only for credit kinds", () => {
    expect(() => validateEntry(entry("topup", 7000))).not.toThrow();
    expect(() => validateEntry(entry("ad_spend", 500))).toThrow();
    expect(() => validateEntry(entry("refund", 500))).toThrow();
  });

  it("accepts debits only for debit kinds", () => {
    expect(() => validateEntry(entry("ad_spend", -500))).not.toThrow();
    expect(() => validateEntry(entry("refund", -500))).not.toThrow();
    expect(() => validateEntry(entry("topup", -500))).toThrow();
  });

  it("rejects zero and fractional amounts", () => {
    expect(() => validateEntry(entry("topup", 0))).toThrow();
    expect(() => validateEntry(entry("topup", 10.5))).toThrow();
  });
});

describe("balance & canDebit", () => {
  const entries = [
    entry("topup", 7000), // $70 in
    entry("ad_spend", -1000), // $10 spent
    entry("markup_fee", -150), // 15% markup on the spend
  ];

  it("derives the balance from signed entries", () => {
    expect(balance(entries)).toBe(5850);
  });

  it("allows debits up to the balance and never below zero", () => {
    expect(canDebit(entries, 5850)).toBe(true);
    expect(canDebit(entries, 5851)).toBe(false);
    expect(canDebit(entries, 0)).toBe(false);
    expect(canDebit(entries, -5)).toBe(false);
  });

  it("refundable equals unspent balance", () => {
    expect(refundable(entries)).toBe(5850);
    expect(refundable([entry("ad_spend", -100)])).toBe(0); // never negative
  });
});

describe("runway", () => {
  it("reports whole days at the daily budget", () => {
    const entries = [entry("topup", 11_500)];
    expect(runwayDays(entries, 1000)).toBe(11); // $115 at $10/day
  });

  it("rejects invalid budgets", () => {
    expect(() => runwayDays([], 0)).toThrow();
    expect(() => runwayDays([], -100)).toThrow();
  });
});

describe("minimum first deposit — $10/day floor × 7 days", () => {
  it("enforces the floor for small budgets", () => {
    expect(minFirstDepositUsdMinor(500)).toBe(7000); // below floor → $70
    expect(minFirstDepositUsdMinor(1000)).toBe(7000);
  });

  it("scales with larger budgets", () => {
    expect(minFirstDepositUsdMinor(2500)).toBe(17_500); // $25/day → $175
  });
});
