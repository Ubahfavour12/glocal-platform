/**
 * Withdrawals — paying a customer back their unspent balance.
 *
 * The money goes back the way it came, to the card or account that paid it.
 * The customer is never asked for bank details, which is the point: there is
 * nothing to mistype, nothing for us to store, and nothing an attacker can
 * redirect. Someone who takes over an account can ask for a withdrawal, but it
 * can only go back to a card that is not theirs.
 *
 * Only unspent balance is withdrawable. Delivered ad spend is a service already
 * rendered; it is not sitting in the wallet and cannot be returned.
 *
 * Every check returns a *reason*, because "withdrawal failed" tells someone
 * waiting on their own money nothing at all.
 *
 * The authoritative balance check happens inside `request_withdrawal` in the
 * database, where the wallet row is locked. What is here is the same rule
 * stated early, so the customer is told before they submit rather than after.
 */

/** $10, matching the top-up minimum: below this the payout fee dominates. */
export const MIN_WITHDRAWAL_USD_MINOR = 1000;

export type WithdrawalRefusal =
  | "not_a_number"
  | "below_minimum"
  | "exceeds_balance"
  | "nothing_to_withdraw"
  | "pending_exists";

export type WithdrawalCheck = { ok: true } | { ok: false; reason: WithdrawalRefusal };

/** How much of a balance may be withdrawn. Never negative. */
export function withdrawableUsdMinor(balanceUsdMinor: number): number {
  return Math.max(0, Math.floor(balanceUsdMinor));
}

/**
 * Can this withdrawal be requested? Order matters: the most specific and most
 * actionable refusal wins, so an empty wallet is never reported as "below the
 * minimum", which would imply topping up would help.
 */
export function checkWithdrawal(params: {
  amountUsdMinor: number;
  balanceUsdMinor: number;
  hasPendingWithdrawal: boolean;
}): WithdrawalCheck {
  const { amountUsdMinor, balanceUsdMinor, hasPendingWithdrawal } = params;

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

  return { ok: true };
}

/** What to tell the customer. Plain, and never blames them for our rules. */
export const REFUSAL_MESSAGE: Record<WithdrawalRefusal, string> = {
  not_a_number: "Enter the amount you'd like to withdraw.",
  below_minimum: `The smallest withdrawal is $${MIN_WITHDRAWAL_USD_MINOR / 100}, unless you're taking the whole balance.`,
  exceeds_balance: "That's more than your unspent balance. Money already spent on ads can't be returned.",
  nothing_to_withdraw: "There's nothing to withdraw yet. Your balance is zero.",
  pending_exists: "You already have a withdrawal in progress. It has to finish before you start another.",
};
