/**
 * Withdrawals — paying a customer back their unspent balance.
 *
 * Being able to ask for the money back is the other half of taking it, so the
 * rules here are deliberately strict in the customer's favour and explicit
 * about what they refuse. Every check returns a *reason*, because "withdrawal
 * failed" tells someone waiting on their own money nothing at all.
 *
 * Only unspent balance is withdrawable. Delivered ad spend is a service already
 * rendered; it is not sitting in the wallet and cannot be returned.
 *
 * The authoritative balance check happens inside `request_withdrawal` in the
 * database, where the wallet row is locked. What is here is the same rule
 * stated early, so the customer is told before they submit rather than after.
 */

/** $10, matching the top-up minimum: below this the payout fee dominates. */
export const MIN_WITHDRAWAL_USD_MINOR = 1000;

export interface WithdrawalDestination {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export type WithdrawalRefusal =
  | "not_a_number"
  | "below_minimum"
  | "exceeds_balance"
  | "nothing_to_withdraw"
  | "pending_exists"
  | "bad_destination";

export type WithdrawalCheck = { ok: true } | { ok: false; reason: WithdrawalRefusal };

/** How much of a balance may be withdrawn. Never negative. */
export function withdrawableUsdMinor(balanceUsdMinor: number): number {
  return Math.max(0, Math.floor(balanceUsdMinor));
}

/**
 * NUBAN account numbers are exactly ten digits. Checking the shape here turns
 * a payout that would silently fail days later into a correction made while
 * the customer is still looking at the form.
 */
export function isValidDestination(d: Partial<WithdrawalDestination> | null): boolean {
  if (!d) return false;
  const bank = d.bankName?.trim() ?? "";
  const name = d.accountName?.trim() ?? "";
  const number = d.accountNumber?.trim() ?? "";
  if (bank.length < 2 || name.length < 2) return false;
  return /^\d{10}$/.test(number);
}

/**
 * Can this withdrawal be requested? Order matters: the most specific and most
 * actionable refusal wins, so an empty wallet is never reported as "below the
 * minimum", which would imply topping up would help.
 */
export function checkWithdrawal(params: {
  amountUsdMinor: number;
  balanceUsdMinor: number;
  destination: Partial<WithdrawalDestination> | null;
  hasPendingWithdrawal: boolean;
}): WithdrawalCheck {
  const { amountUsdMinor, balanceUsdMinor, destination, hasPendingWithdrawal } = params;

  if (hasPendingWithdrawal) return { ok: false, reason: "pending_exists" };

  const available = withdrawableUsdMinor(balanceUsdMinor);
  if (available <= 0) return { ok: false, reason: "nothing_to_withdraw" };

  if (!Number.isInteger(amountUsdMinor) || amountUsdMinor <= 0) {
    return { ok: false, reason: "not_a_number" };
  }
  if (amountUsdMinor > available) return { ok: false, reason: "exceeds_balance" };

  // Checked after the balance, so someone whose whole balance is under $10 is
  // told they can withdraw all of it rather than being blocked by a minimum
  // they can never reach.
  if (amountUsdMinor < MIN_WITHDRAWAL_USD_MINOR && amountUsdMinor !== available) {
    return { ok: false, reason: "below_minimum" };
  }

  if (!isValidDestination(destination)) return { ok: false, reason: "bad_destination" };

  return { ok: true };
}

/** What to tell the customer. Plain, and never blames them for our rules. */
export const REFUSAL_MESSAGE: Record<WithdrawalRefusal, string> = {
  not_a_number: "Enter the amount you'd like to withdraw.",
  below_minimum: `The smallest withdrawal is $${MIN_WITHDRAWAL_USD_MINOR / 100}, unless you're taking the whole balance.`,
  exceeds_balance: "That's more than your unspent balance. Money already spent on ads can't be returned.",
  nothing_to_withdraw: "There's nothing to withdraw yet. Your balance is zero.",
  pending_exists: "You already have a withdrawal in progress. It has to finish before you start another.",
  bad_destination: "Check the bank details. The account number should be the 10 digits on your account.",
};
