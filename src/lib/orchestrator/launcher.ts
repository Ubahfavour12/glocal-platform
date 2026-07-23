/**
 * Morning launcher — Phase 2.2 (Blueprint §4 "morning launch").
 * Turns an APPROVED evening plan into real Meta ad objects, each minted with
 * its own smart link + ref code so attribution works from the first click.
 *
 * Safety, non-negotiable (Dev Plan: two BMs; nothing spends without approval):
 *  - Only runs against a plan the customer already approved.
 *  - Every Meta object is created PAUSED. The agent's day-time monitors and
 *    the wallet gate decide enabling; this job never enables.
 *  - The final ad object needs a payment method; on an account without one
 *    Meta returns 1359188, which we record as "awaiting_payment_method" — a
 *    normal pre-dogfooding state, NOT an error.
 *
 * Pure orchestration with injected adapters, so the whole sequence is
 * fixture-tested offline and lights up on real Meta when keys + funds land.
 */

import type { CallToAction } from "@/lib/meta/client";

export interface PlanAd {
  role: "champion" | "challenger";
  conceptId: string;
  hook: string;
  copy: string;
  cta: CallToAction;
  budgetUsdMinor: number;
  mediaUrl?: string;
}

export interface LaunchContext {
  businessId: string;
  planDate: string; // YYYY-MM-DD
  adAccountId: string; // resolved child account (act_...)
  pageId: string;
  campaignId: string; // resolved/created campaign
  countries: string[];
}

export interface AdLaunchResult {
  conceptId: string;
  role: PlanAd["role"];
  status: "launched" | "awaiting_payment" | "error";
  /** smart-link code = the ad's ref code (rides the WhatsApp prefill) */
  code: string;
  platformAdSetId?: string;
  platformAdId?: string;
  detail?: string;
}

export interface CreatedAd {
  adId?: string;
  /** true when Meta blocked only on a missing payment method (1359188) */
  awaitingPayment: boolean;
}

export interface LaunchAdapters {
  /** Create the PAUSED ad set (its own budget; macro-geo only). */
  createAdSet(ctx: LaunchContext, ad: PlanAd): Promise<{ adSetId: string }>;
  /** Mint a smart link for this ad; returns the code + full URL. */
  mintSmartLink(businessId: string, adKey: string): Promise<{ code: string; url: string }>;
  /** Create the link-ad creative pointing at the smart link. */
  createCreative(
    ctx: LaunchContext,
    ad: PlanAd,
    linkUrl: string,
  ): Promise<{ creativeId: string }>;
  /** Create the PAUSED ad; may come back awaiting a payment method. */
  createAd(
    ctx: LaunchContext,
    params: { name: string; adSetId: string; creativeId: string },
  ): Promise<CreatedAd>;
  /** Persist ads/campaign rows + link the smart link to the ad. */
  recordAd(row: {
    businessId: string;
    campaignId: string;
    conceptId: string;
    role: PlanAd["role"];
    smartLinkCode: string;
    platformAdSetId: string;
    platformCreativeId: string;
    platformAdId: string | null;
    budgetUsdMinor: number;
    status: string;
  }): Promise<void>;
  audit(businessId: string, action: string, detail: unknown): Promise<void>;
}

export interface LaunchSummary {
  planDate: string;
  results: AdLaunchResult[];
  launched: number;
  awaitingPayment: number;
  errors: number;
}

const nameFor = (ctx: LaunchContext, ad: PlanAd) =>
  `${ctx.planDate} ${ad.role} ${ad.conceptId.slice(0, 8)}`;

/**
 * Launch every ad in the plan. Each ad is independent: one failing (or
 * awaiting payment) never stops the others, and everything is recorded.
 */
export async function launchPlan(
  ctx: LaunchContext,
  ads: PlanAd[],
  adapters: LaunchAdapters,
): Promise<LaunchSummary> {
  const results: AdLaunchResult[] = [];

  for (const ad of ads) {
    const name = nameFor(ctx, ad);
    try {
      const { adSetId } = await adapters.createAdSet(ctx, ad);
      const link = await adapters.mintSmartLink(ctx.businessId, `${ctx.planDate}:${ad.conceptId}`);
      const { creativeId } = await adapters.createCreative(ctx, ad, link.url);
      const created = await adapters.createAd(ctx, { name, adSetId, creativeId });

      const status = created.awaitingPayment ? "awaiting_payment" : "launched";
      await adapters.recordAd({
        businessId: ctx.businessId,
        campaignId: ctx.campaignId,
        conceptId: ad.conceptId,
        role: ad.role,
        smartLinkCode: link.code,
        platformAdSetId: adSetId,
        platformCreativeId: creativeId,
        platformAdId: created.adId ?? null,
        budgetUsdMinor: ad.budgetUsdMinor,
        status,
      });
      results.push({
        conceptId: ad.conceptId,
        role: ad.role,
        status,
        code: link.code,
        platformAdSetId: adSetId,
        platformAdId: created.adId,
      });
    } catch (e) {
      results.push({
        conceptId: ad.conceptId,
        role: ad.role,
        status: "error",
        code: "",
        detail: (e as Error).message.slice(0, 200),
      });
    }
  }

  const summary: LaunchSummary = {
    planDate: ctx.planDate,
    results,
    launched: results.filter((r) => r.status === "launched").length,
    awaitingPayment: results.filter((r) => r.status === "awaiting_payment").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  await adapters.audit(ctx.businessId, "plan_launched", summary);
  return summary;
}

/** Is a Meta error the "no payment method on the account" block (1359188)? */
export function isPaymentMethodError(message: string): boolean {
  return /1359188|payment method|funding source|add a payment/i.test(message);
}
