/**
 * What a customer costs to serve, against what they pay.
 *
 * The question this answers is the one the production review said nobody can
 * answer: "you know your monthly AI bill, but not what it costs to serve one
 * customer." For this product that is not a nicety. Renders bill per
 * generation, the caps scale with tier, and the subscription is fixed — so a
 * Scale customer rendering twelve times a day can plausibly cost more to serve
 * than they pay, and nothing anywhere would say so until an invoice arrived.
 *
 * Two revenue lines, kept apart on purpose:
 *
 *   SUBSCRIPTION is what they pay us for the software.
 *   MARKUP is the fee on ad spend — the actual business model.
 *
 * Netting them into one number would hide the case that matters: a customer
 * whose subscription does not cover their renders but whose ad spend easily
 * does. That customer is fine. A customer with no ad spend and heavy rendering
 * is not, and they look identical once the columns are added up.
 *
 * Pure, so the arithmetic is testable without a database.
 */

import { subscriptionPriceUsdMinor } from "@/lib/billing/subscribe";
import { isTierId } from "@/lib/billing/subscription";

export interface CustomerCosts {
  businessId: string;
  name: string;
  tier: string;
  /** Sum of render_cost_usd_minor on this business's creatives, for the period. */
  renderCostUsdMinor: number;
  renderCount: number;
  /** Markup fees charged on ad spend, for the period. */
  markupRevenueUsdMinor: number;
  /** Whether the subscription was active for the period. */
  subscribed: boolean;
}

export interface Margin {
  businessId: string;
  name: string;
  tier: string;
  subscriptionUsdMinor: number;
  markupUsdMinor: number;
  revenueUsdMinor: number;
  costUsdMinor: number;
  marginUsdMinor: number;
  renderCount: number;
  /** Cost to serve as a share of revenue. null when they pay nothing at all. */
  costRatio: number | null;
  /** True when serving them costs more than they pay. */
  underwater: boolean;
}

export function marginFor(c: CustomerCosts): Margin {
  // The tier comes from a database column, so it is a string until proven
  // otherwise. An unrecognised one earns no revenue rather than throwing: a
  // dashboard that crashes on one odd row shows nothing about the other twenty.
  const subscription = c.subscribed && isTierId(c.tier) ? subscriptionPriceUsdMinor(c.tier) : 0;
  const revenue = subscription + c.markupRevenueUsdMinor;
  const cost = c.renderCostUsdMinor;
  return {
    businessId: c.businessId,
    name: c.name,
    tier: c.tier,
    subscriptionUsdMinor: subscription,
    markupUsdMinor: c.markupRevenueUsdMinor,
    revenueUsdMinor: revenue,
    costUsdMinor: cost,
    marginUsdMinor: revenue - cost,
    renderCount: c.renderCount,
    // A free customer rendering costs money against zero revenue. Dividing
    // would be Infinity; null says "there is no ratio" rather than pretending.
    costRatio: revenue > 0 ? cost / revenue : null,
    underwater: cost > revenue,
  };
}

/** Worst margin first — the rows worth looking at are the expensive ones. */
export function rankByMargin(rows: CustomerCosts[]): Margin[] {
  return rows.map(marginFor).sort((a, b) => a.marginUsdMinor - b.marginUsdMinor);
}

export interface EconomicsTotals {
  revenueUsdMinor: number;
  costUsdMinor: number;
  marginUsdMinor: number;
  underwaterCount: number;
  renderCount: number;
}

export function economicsTotals(rows: CustomerCosts[]): EconomicsTotals {
  const margins = rows.map(marginFor);
  return {
    revenueUsdMinor: margins.reduce((s, m) => s + m.revenueUsdMinor, 0),
    costUsdMinor: margins.reduce((s, m) => s + m.costUsdMinor, 0),
    marginUsdMinor: margins.reduce((s, m) => s + m.marginUsdMinor, 0),
    underwaterCount: margins.filter((m) => m.underwater).length,
    renderCount: margins.reduce((s, m) => s + m.renderCount, 0),
  };
}
