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
 * FOUR COST LINES, FOR THE SAME REASON. This file used to compute cost as
 * renders and nothing else, and call the result the margin. Three real costs
 * were invisible: the LLM (never measured anywhere — the Anthropic client
 * threw the `usage` block away), the payment processor's cut (never read off
 * the charge), and fixed infrastructure (allocated to nobody). So `underwater`
 * could not fire for an account the LLM bill had sunk, and the dashboard
 * reported a margin that was systematically too good — the same overstatement
 * made in conversation, except a dashboard repeats it every time it is opened.
 *
 * Each line is reported separately as well as totalled, because "this account
 * is underwater" is not actionable and "this account is underwater on LLM"
 * is: the lever for renders is the tier cap, for LLM the model, for fees the
 * rail, for infra nothing at all.
 *
 * Pure, so the arithmetic is testable without a database.
 */

import { subscriptionPriceUsdMinor } from "@/lib/billing/subscribe";
import { isTierId } from "@/lib/billing/subscription";

/**
 * Monthly fixed cost to keep the lights on: hosting, database, and the
 * render subscription that is billed whether or not anyone renders.
 *
 * An ALLOCATION, not a measurement — the same honesty `creative/pricing.ts`
 * insists on about its render rates. Dividing a fixed cost by headcount says
 * nothing about which customer caused it; it exists so the per-customer
 * figure is not quietly missing the largest bill of all.
 *
 * Env-overridable, because the real number arrives as invoices and should not
 * need a deploy. Default is deliberately an underestimate of a real stack
 * rather than a guess at one: better to be visibly conservative than
 * confidently wrong.
 */
export const DEFAULT_FIXED_MONTHLY_COST_USD_MINOR = 10_000; // $100

export function fixedMonthlyCostUsdMinor(): number {
  const raw = process.env.FIXED_MONTHLY_COST_USD_MINOR;
  if (!raw) return DEFAULT_FIXED_MONTHLY_COST_USD_MINOR;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_FIXED_MONTHLY_COST_USD_MINOR;
}

/**
 * The fixed cost each active business carries this period.
 *
 * Rounded UP, so the allocation is never cheaper than the bill, and zero when
 * there is nobody to allocate to — charging the fixed cost to an empty list
 * would divide by zero and put Infinity on a dashboard.
 */
export function infraShareUsdMinor(activeBusinesses: number): number {
  if (!Number.isFinite(activeBusinesses) || activeBusinesses <= 0) return 0;
  return Math.ceil(fixedMonthlyCostUsdMinor() / activeBusinesses);
}

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
  /** Claude tokens, from llm_usage. Optional: zero where not yet recorded. */
  llmCostUsdMinor?: number;
  /** What the payment processor kept, from payment_fees. */
  processingFeeUsdMinor?: number;
  /** This business's slice of the fixed monthly bill. */
  infraShareUsdMinor?: number;
}

export interface Margin {
  businessId: string;
  name: string;
  tier: string;
  subscriptionUsdMinor: number;
  markupUsdMinor: number;
  revenueUsdMinor: number;
  /** Every cost line, kept apart, because each has a different lever. */
  renderCostUsdMinor: number;
  llmCostUsdMinor: number;
  processingFeeUsdMinor: number;
  infraShareUsdMinor: number;
  /** The four above, added up. */
  costUsdMinor: number;
  marginUsdMinor: number;
  renderCount: number;
  /** Cost to serve as a share of revenue. null when they pay nothing at all. */
  costRatio: number | null;
  /** True when serving them costs more than they pay. */
  underwater: boolean;
  /** Which single cost line is the largest. Null when there is no cost. */
  biggestCost: "renders" | "llm" | "processing" | "infra" | null;
}

/** Treat a missing or nonsense figure as zero rather than poisoning a total. */
const n = (v: number | undefined): number =>
  Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0;

export function marginFor(c: CustomerCosts): Margin {
  // The tier comes from a database column, so it is a string until proven
  // otherwise. An unrecognised one earns no revenue rather than throwing: a
  // dashboard that crashes on one odd row shows nothing about the other twenty.
  const subscription = c.subscribed && isTierId(c.tier) ? subscriptionPriceUsdMinor(c.tier) : 0;
  const revenue = subscription + c.markupRevenueUsdMinor;

  const renders = n(c.renderCostUsdMinor);
  const llm = n(c.llmCostUsdMinor);
  const processing = n(c.processingFeeUsdMinor);
  const infra = n(c.infraShareUsdMinor);
  const cost = renders + llm + processing + infra;

  const lines: [Margin["biggestCost"], number][] = [
    ["renders", renders],
    ["llm", llm],
    ["processing", processing],
    ["infra", infra],
  ];
  const biggest = lines.reduce((best, line) => (line[1] > best[1] ? line : best));

  return {
    businessId: c.businessId,
    name: c.name,
    tier: c.tier,
    subscriptionUsdMinor: subscription,
    markupUsdMinor: c.markupRevenueUsdMinor,
    revenueUsdMinor: revenue,
    renderCostUsdMinor: renders,
    llmCostUsdMinor: llm,
    processingFeeUsdMinor: processing,
    infraShareUsdMinor: infra,
    costUsdMinor: cost,
    marginUsdMinor: revenue - cost,
    renderCount: c.renderCount,
    // A free customer rendering costs money against zero revenue. Dividing
    // would be Infinity; null says "there is no ratio" rather than pretending.
    costRatio: revenue > 0 ? cost / revenue : null,
    underwater: cost > revenue,
    biggestCost: cost > 0 ? biggest[0] : null,
  };
}

/** Worst margin first — the rows worth looking at are the expensive ones. */
export function rankByMargin(rows: CustomerCosts[]): Margin[] {
  return rows.map(marginFor).sort((a, b) => a.marginUsdMinor - b.marginUsdMinor);
}

export interface EconomicsTotals {
  revenueUsdMinor: number;
  costUsdMinor: number;
  renderCostUsdMinor: number;
  llmCostUsdMinor: number;
  processingFeeUsdMinor: number;
  infraShareUsdMinor: number;
  marginUsdMinor: number;
  underwaterCount: number;
  renderCount: number;
}

export function economicsTotals(rows: CustomerCosts[]): EconomicsTotals {
  const margins = rows.map(marginFor);
  const sum = (f: (m: Margin) => number) => margins.reduce((t, m) => t + f(m), 0);
  return {
    revenueUsdMinor: sum((m) => m.revenueUsdMinor),
    costUsdMinor: sum((m) => m.costUsdMinor),
    renderCostUsdMinor: sum((m) => m.renderCostUsdMinor),
    llmCostUsdMinor: sum((m) => m.llmCostUsdMinor),
    processingFeeUsdMinor: sum((m) => m.processingFeeUsdMinor),
    infraShareUsdMinor: sum((m) => m.infraShareUsdMinor),
    marginUsdMinor: sum((m) => m.marginUsdMinor),
    underwaterCount: margins.filter((m) => m.underwater).length,
    renderCount: sum((m) => m.renderCount),
  };
}

/**
 * What this number still does not include, stated next to it on the page.
 *
 * The first version of this file was wrong by omission, not by arithmetic.
 * Naming what is still missing is the cheapest way to stop the same mistake
 * being made again by a reader who assumes the total is complete.
 */
export const EXCLUDED_FROM_MARGIN = [
  "FX spread on naira in and dollars out",
  "support time",
  "refunds and chargebacks",
] as const;
