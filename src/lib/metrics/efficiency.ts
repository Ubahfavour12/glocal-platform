/**
 * What an ad actually costs to bring one customer, and whether that is worth it.
 *
 * Spend, clicks and revenue each describe a piece of the day. None of them
 * answers the only question a shop owner really has: does putting money in
 * bring back more than I put in? That answer is two numbers held together,
 * what one customer costs to acquire and what one customer is worth, and it
 * is useless unless both are shown at once. A cost per customer of $4 reads as
 * cheap next to a $25 order and ruinous next to a $3 one.
 *
 * Every function here refuses to invent a number it cannot support. Dividing
 * by a day with no customers gives infinity, and infinity rendered on a
 * dashboard looks like a bug or a catastrophe; both are worse than "not yet".
 */

import { MIN_ATTRIBUTED_ORDERS } from "@/lib/tracking/consistency";

export type EfficiencyVerdict =
  | "too_early"
  | "profitable"
  | "breaking_even"
  | "losing";

export interface Efficiency {
  /** Ad spend divided by customers won. Null when nobody has bought yet. */
  costPerCustomerUsdMinor: number | null;
  /** What an average customer actually paid. Null with no sales. */
  averageOrderUsdMinor: number | null;
  /** Kept per customer after the ad cost of winning them. */
  marginPerCustomerUsdMinor: number | null;
  /** Revenue per unit of spend, the classic ROAS. Null with no spend. */
  returnOnSpend: number | null;
  verdict: EfficiencyVerdict;
  /** One sentence in the agent's voice. Always safe to render. */
  note: string;
}

export interface EfficiencyInput {
  spendUsdMinor: number;
  revenueUsdMinor: number;
  /** How many customers actually bought, not clicks or conversations. */
  customers: number;
}

const money = (m: number) => `$${(m / 100).toFixed(2)}`;

/**
 * Judge a day (or a window) of spending.
 *
 * A verdict needs enough customers to mean anything: one lucky sale on a
 * quiet Tuesday is not proof an ad works. The threshold is the same one the
 * duel uses to switch to revenue judging, so the dashboard and the agent never
 * disagree about when the money became believable.
 */
export function adEfficiency(input: EfficiencyInput): Efficiency {
  const spend = Math.max(0, Math.round(input.spendUsdMinor));
  const revenue = Math.max(0, Math.round(input.revenueUsdMinor));
  const customers = Math.max(0, Math.floor(input.customers));

  const costPerCustomerUsdMinor = customers > 0 ? Math.round(spend / customers) : null;
  const averageOrderUsdMinor = customers > 0 ? Math.round(revenue / customers) : null;
  const marginPerCustomerUsdMinor =
    costPerCustomerUsdMinor !== null && averageOrderUsdMinor !== null
      ? averageOrderUsdMinor - costPerCustomerUsdMinor
      : null;
  const returnOnSpend = spend > 0 ? revenue / spend : null;

  if (customers === 0) {
    return {
      costPerCustomerUsdMinor: null,
      averageOrderUsdMinor: null,
      marginPerCustomerUsdMinor: null,
      returnOnSpend,
      verdict: "too_early",
      note:
        spend > 0
          ? `${money(spend)} spent and no customer yet. Too early to say what one costs you.`
          : "Nothing spent yet, so there is nothing to judge.",
    };
  }

  const cpc = costPerCustomerUsdMinor as number;
  const aov = averageOrderUsdMinor as number;
  const margin = marginPerCustomerUsdMinor as number;

  if (customers < MIN_ATTRIBUTED_ORDERS) {
    return {
      costPerCustomerUsdMinor: cpc,
      averageOrderUsdMinor: aov,
      marginPerCustomerUsdMinor: margin,
      returnOnSpend,
      verdict: "too_early",
      note: `${money(cpc)} per customer so far, but on ${customers} sale${customers === 1 ? "" : "s"}. I need ${MIN_ATTRIBUTED_ORDERS} before I would trust that number.`,
    };
  }

  // Within a tenth of the order value either way is noise, not a trend.
  const breakEvenBand = Math.max(1, Math.round(aov * 0.1));
  if (Math.abs(margin) <= breakEvenBand) {
    return {
      costPerCustomerUsdMinor: cpc,
      averageOrderUsdMinor: aov,
      marginPerCustomerUsdMinor: margin,
      returnOnSpend,
      verdict: "breaking_even",
      note: `Each customer costs ${money(cpc)} and spends ${money(aov)}. You are running level, so the ads pay for themselves and no more.`,
    };
  }

  if (margin < 0) {
    return {
      costPerCustomerUsdMinor: cpc,
      averageOrderUsdMinor: aov,
      marginPerCustomerUsdMinor: margin,
      returnOnSpend,
      verdict: "losing",
      note: `Each customer costs ${money(cpc)} to win and spends ${money(aov)}, so every sale loses you ${money(Math.abs(margin))} before your own costs. Worth pausing or raising prices.`,
    };
  }

  return {
    costPerCustomerUsdMinor: cpc,
    averageOrderUsdMinor: aov,
    marginPerCustomerUsdMinor: margin,
    returnOnSpend,
    verdict: "profitable",
    note: `Each customer costs ${money(cpc)} to win and spends ${money(aov)}, leaving ${money(margin)} before your own costs.`,
  };
}

/** Display helper: the headline figure, or a dash when it cannot be known. */
export function formatCostPerCustomer(e: Efficiency): string {
  return e.costPerCustomerUsdMinor === null ? "—" : money(e.costPerCustomerUsdMinor);
}

/** Display helper: the comparison that makes the headline figure mean something. */
export function formatAgainstOrder(e: Efficiency): string {
  if (e.averageOrderUsdMinor === null) return "no sales yet";
  return `vs ${money(e.averageOrderUsdMinor)} average order`;
}
