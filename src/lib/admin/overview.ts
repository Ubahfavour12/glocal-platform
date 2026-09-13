/**
 * The founder console's data shaping, kept pure so it is testable without a
 * database and without the service role.
 *
 * The console exists to answer one question during the dogfood — "is this
 * working, and if not, where is it stuck?" — so the rows are ordered by what
 * needs attention rather than alphabetically or by signup date.
 */

export type Health = "spending" | "ready" | "empty_wallet" | "free" | "onboarding";

export interface CustomerRow {
  businessId: string;
  name: string;
  ownerEmail: string | null;
  plan: string;
  currency: string;
  balanceUsdMinor: number;
  dailyBudgetUsdMinor: number;
  liveAds: number;
  lastActivityAt: string | null;
  createdAt: string;
}

/**
 * What is actually stopping this customer, in one word.
 *
 * Ordered by which explanation is most useful, not by severity. A free account
 * with an empty wallet is blocked by being free — telling them to add money
 * would be the wrong answer, because money alone would not let them launch.
 */
export function health(row: CustomerRow): Health {
  if (row.plan === "free") return "free";
  if (row.balanceUsdMinor <= 0) return "empty_wallet";
  if (row.liveAds > 0) return "spending";
  if (row.dailyBudgetUsdMinor > 0) return "ready";
  return "onboarding";
}

const HEALTH_ORDER: Record<Health, number> = {
  // Paying, funded, and still not running is the most urgent thing on the
  // screen: they are ready and something is in the way.
  ready: 0,
  empty_wallet: 1,
  onboarding: 2,
  spending: 3,
  free: 4,
};

export const HEALTH_LABEL: Record<Health, string> = {
  spending: "Running ads",
  ready: "Funded, not running",
  empty_wallet: "Wallet empty",
  free: "Free plan",
  onboarding: "Not set up",
};

/** Needs-attention first, then most recently active. */
export function rankCustomers(rows: CustomerRow[]): CustomerRow[] {
  return [...rows].sort((a, b) => {
    const d = HEALTH_ORDER[health(a)] - HEALTH_ORDER[health(b)];
    if (d !== 0) return d;
    return (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt);
  });
}

export interface Totals {
  customers: number;
  paying: number;
  running: number;
  walletUsdMinor: number;
}

/**
 * The numbers across the top.
 *
 * `walletUsdMinor` is money customers have put in and not yet spent — a
 * liability, not revenue. Named on the page as such, because a big number here
 * is money that is owed back, and reading it as income would be the single most
 * expensive misunderstanding this screen could cause.
 */
export function totals(rows: CustomerRow[]): Totals {
  return {
    customers: rows.length,
    paying: rows.filter((r) => r.plan !== "free").length,
    running: rows.filter((r) => health(r) === "spending").length,
    walletUsdMinor: rows.reduce((sum, r) => sum + Math.max(0, r.balanceUsdMinor), 0),
  };
}
