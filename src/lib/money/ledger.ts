/**
 * Wallet ledger — Blueprint §5.1, TRD §2.
 * Funds are PSP-held; this ledger is the platform's authoritative record of
 * what each business may spend. Entries are append-only and signed:
 * credits positive, debits negative. Balance is always derived, never stored.
 */

export type LedgerKind =
  | "topup"
  | "ad_spend"
  | "markup_fee"
  | "subscription"
  | "refund"
  | "adjustment";

export interface LedgerEntry {
  kind: LedgerKind;
  /** Signed USD minor units. Credits positive, debits negative. */
  amountUsdMinor: number;
  createdAt: Date;
}

const CREDIT_KINDS: ReadonlySet<LedgerKind> = new Set(["topup", "adjustment"]);
const DEBIT_KINDS: ReadonlySet<LedgerKind> = new Set([
  "ad_spend",
  "markup_fee",
  "subscription",
  "refund",
  "adjustment",
]);

export function validateEntry(entry: LedgerEntry): void {
  if (!Number.isInteger(entry.amountUsdMinor) || entry.amountUsdMinor === 0) {
    throw new Error("ledger amounts must be non-zero integers of USD minor units");
  }
  if (entry.amountUsdMinor > 0 && !CREDIT_KINDS.has(entry.kind)) {
    throw new Error(`${entry.kind} cannot be a credit`);
  }
  if (entry.amountUsdMinor < 0 && !DEBIT_KINDS.has(entry.kind)) {
    throw new Error(`${entry.kind} cannot be a debit`);
  }
}

export function balance(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amountUsdMinor, 0);
}

/**
 * Whether a debit of `amountUsdMinor` (positive number) is allowed.
 * The ledger can never go negative: ad spend halts at zero spendable balance
 * (TRD §4.2 spend guardrail monitor).
 */
export function canDebit(entries: readonly LedgerEntry[], amountUsdMinor: number): boolean {
  if (!Number.isInteger(amountUsdMinor) || amountUsdMinor <= 0) return false;
  return balance(entries) >= amountUsdMinor;
}

/** Refundable amount: the unspent balance (delivered spend is never refunded). */
export function refundable(entries: readonly LedgerEntry[]): number {
  return Math.max(0, balance(entries));
}

/**
 * Runway in whole days at the given daily budget.
 * Blueprint UX: "at the current budget you have 11 days of runway".
 */
export function runwayDays(entries: readonly LedgerEntry[], dailyBudgetUsdMinor: number): number {
  if (!Number.isInteger(dailyBudgetUsdMinor) || dailyBudgetUsdMinor <= 0) {
    throw new Error("daily budget must be a positive integer of USD minor units");
  }
  return Math.floor(Math.max(0, balance(entries)) / dailyBudgetUsdMinor);
}

/** $10/day floor (late-locked decision): minimum first deposit = 7 days runway. */
export const MIN_DAILY_BUDGET_USD_MINOR = 1_000;
export const MIN_FIRST_DEPOSIT_DAYS = 7;

export function minFirstDepositUsdMinor(dailyBudgetUsdMinor: number): number {
  const daily = Math.max(dailyBudgetUsdMinor, MIN_DAILY_BUDGET_USD_MINOR);
  return daily * MIN_FIRST_DEPOSIT_DAYS;
}
