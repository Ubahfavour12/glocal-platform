/**
 * Wallet health — how a customer knows their wallet is running low.
 * Runway (days = balance / daily budget) is more meaningful than a dollar
 * figure because it reflects the customer's own spend rate. One shared
 * computation feeds the approval card, the wallet screen (colour state), and
 * the notification system, so the "running low" line is consistent everywhere.
 *
 * The warning fires EARLY (3 days out) so the customer can top up before the
 * agent ever has to pause. Empty means new spend is already paused; the agent
 * never overspends the wallet.
 */

export const LOW_RUNWAY_DAYS = 3;
export const CRITICAL_RUNWAY_DAYS = 1;

export type WalletStatus = "healthy" | "low" | "critical" | "empty";

export interface WalletHealth {
  /** whole days of runway remaining (floored); 0 when empty */
  runwayDays: number;
  status: WalletStatus;
  /** plain-language line for the card, screen, or push */
  message: string;
  /** true once the customer should be told, so the UI/notifier can gate on it */
  shouldWarn: boolean;
}

export function computeWalletHealth(
  balanceUsdMinor: number,
  dailyBudgetUsdMinor: number,
): WalletHealth {
  if (balanceUsdMinor <= 0) {
    return {
      runwayDays: 0,
      status: "empty",
      message: "Your wallet is empty, so I have paused new spend. Add funds to restart your ads.",
      shouldWarn: true,
    };
  }
  const days = dailyBudgetUsdMinor > 0 ? balanceUsdMinor / dailyBudgetUsdMinor : Infinity;
  const whole = Math.floor(days);

  if (days < CRITICAL_RUNWAY_DAYS) {
    return {
      runwayDays: whole,
      status: "critical",
      message: "Your wallet runs out today. Top up now to keep your ads running.",
      shouldWarn: true,
    };
  }
  if (days < LOW_RUNWAY_DAYS) {
    return {
      runwayDays: whole,
      status: "low",
      message: `About ${whole} ${whole === 1 ? "day" : "days"} of budget left. Top up soon to avoid a pause.`,
      shouldWarn: true,
    };
  }
  return {
    runwayDays: Number.isFinite(days) ? whole : whole,
    status: "healthy",
    message: `About ${whole} days of budget left.`,
    shouldWarn: false,
  };
}
