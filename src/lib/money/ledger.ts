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
  | "adjustment"
  /**
   * Money promised to a day's ads, moved out of spendable balance the moment
   * the plan launches and returned when that day is done. Signed both ways:
   * negative places the hold, positive releases it.
   */
  | "budget_hold";

export interface LedgerEntry {
  kind: LedgerKind;
  /** Signed USD minor units. Credits positive, debits negative. */
  amountUsdMinor: number;
  createdAt: Date;
}

const CREDIT_KINDS: ReadonlySet<LedgerKind> = new Set(["topup", "adjustment", "budget_hold"]);
const DEBIT_KINDS: ReadonlySet<LedgerKind> = new Set([
  "ad_spend",
  "markup_fee",
  "subscription",
  "refund",
  "adjustment",
  "budget_hold",
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
 * How much is currently held against today's ads.
 *
 * Holds net to zero once released, so this is simply the negative of the
 * budget_hold entries' running sum. Reported separately from the balance
 * because "your money went somewhere" needs a name, not just a smaller number.
 */
export function heldForBudget(entries: readonly LedgerEntry[]): number {
  const net = entries
    .filter((e) => e.kind === "budget_hold")
    .reduce((sum, e) => sum + e.amountUsdMinor, 0);
  return Math.max(0, -net);
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

/**
 * The $10/day floor, and the single line that excluded the micro market.
 *
 * It was never a pricing choice. It falls out of the duel: the default persona
 * splits 70/30 and MIN_CHALLENGER_USD_MINOR is $3, so below $10/day the
 * challenger pool cannot fund even one challenger and no testing happens.
 *
 * Which is only binding for tiers that RUN a duel. Spark does not -- it rotates
 * one ad at a time -- so the arithmetic that produced this number does not
 * apply to it, and applying it anyway priced out the overwhelming majority of
 * businesses in this market for a reason that was not about them.
 */
export const MIN_DAILY_BUDGET_USD_MINOR = 1_000;

/**
 * Spark's floor: about N2,000/day. Low enough for a market trader, high enough
 * that a day's spend still buys a meaningful number of impressions rather than
 * dribbling out too thin for the ad to be served at all.
 */
export const SPARK_MIN_DAILY_BUDGET_USD_MINOR = 150;

export const MIN_FIRST_DEPOSIT_DAYS = 7;

/**
 * Pure: the daily-budget floor for a tier.
 *
 * Anything that is not Spark keeps the duel floor, including an unrecognised
 * value: a tier nobody has mapped must not silently inherit the lowest floor
 * in the product.
 */
export function minDailyBudgetFor(tier: string | null | undefined): number {
  return tier === "spark" ? SPARK_MIN_DAILY_BUDGET_USD_MINOR : MIN_DAILY_BUDGET_USD_MINOR;
}

export function minFirstDepositUsdMinor(
  dailyBudgetUsdMinor: number,
  tier?: string | null,
): number {
  const daily = Math.max(dailyBudgetUsdMinor, minDailyBudgetFor(tier));
  return daily * MIN_FIRST_DEPOSIT_DAYS;
}
