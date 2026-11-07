/**
 * Live LaunchAdapters — binds the morning launcher to the Meta client and
 * Supabase. Resolves (or creates) the child ad account and page, takes the
 * campaign id from the launch context rather than creating one itself,
 * mints smart links from the business's connection door, and creates every
 * Meta object PAUSED. Meta's no-payment-method block (1359188) is caught and
 * reported as awaiting_payment, never thrown.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createLinkAdCreative,
  createPausedAd,
  createPausedAdSet,
  metaConfigFromEnv,
  pauseAd,
  type MetaConfig,
} from "@/lib/meta/client";
import { destinationUrl, type ConnectionMode } from "@/lib/tracking/modes";
import { isPaymentMethodError, type LaunchAdapters, type LaunchContext } from "./launcher";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gg-platform-dun.vercel.app";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  let s = "GL-";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export interface BusinessLaunchInfo {
  connectionMode: ConnectionMode;
  destination: string; // wa.me digits or url (raw from onboarding)
  countryCode?: string;
}

export function liveLaunchAdapters(
  supabase: SupabaseClient,
  info: BusinessLaunchInfo,
  cfg: MetaConfig = metaConfigFromEnv(),
): LaunchAdapters {
  return {
    async createAdSet(ctx: LaunchContext, ad) {
      return createPausedAdSet(cfg, ctx.adAccountId, {
        name: `${ctx.planDate} ${ad.role} ${ad.conceptId.slice(0, 8)}`,
        campaignId: ctx.campaignId,
        dailyBudgetUsdMinor: ad.budgetUsdMinor,
        countries: ctx.countries.length ? ctx.countries : ["NG"],
        ageMin: ctx.ageMin,
      });
    },

    async mintSmartLink(businessId, adKey) {
      const kind = info.connectionMode === "whatsapp" ? "whatsapp" : "url";
      // Normalise the stored destination the same way the redirect expects.
      const dest =
        info.connectionMode === "whatsapp"
          ? info.destination.replace(/[^0-9]/g, "")
          : destinationUrl(info.connectionMode, info.destination);

      // Retry on the rare code collision (unique constraint on smart_links.code).
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const { error } = await supabase.from("smart_links").insert({
          business_id: businessId,
          code,
          destination_kind: kind,
          destination: dest,
        });
        if (!error) return { code, url: `${BASE_URL}/l/${code}` };
        if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      }
      throw new Error(`could not mint a unique smart link for ${adKey}`);
    },

    async createCreative(ctx, ad, linkUrl) {
      return createLinkAdCreative(cfg, ctx.adAccountId, {
        name: `${ctx.planDate} ${ad.conceptId.slice(0, 8)} creative`,
        pageId: ctx.pageId,
        link: linkUrl,
        message: ad.copy,
        cta: ad.cta,
        imageUrl: ad.mediaUrl,
      });
    },

    async createAd(ctx, params) {
      try {
        const { adId } = await createPausedAd(cfg, ctx.adAccountId, params);
        return { adId, awaitingPayment: false };
      } catch (e) {
        const msg = (e as Error).message;
        if (isPaymentMethodError(msg)) return { awaitingPayment: true };
        throw e;
      }
    },

    async recordAd(row) {
      // Attach the minted smart link to the created ad, then persist the ad row.
      const { data: ad } = await supabase
        .from("ads")
        .insert({
          campaign_id: row.campaignId,
          platform_ad_id: row.platformAdId,
          platform_adset_id: row.platformAdSetId,
          platform_creative_id: row.platformCreativeId,
          budget_usd_minor: row.budgetUsdMinor,
          is_champion: row.role === "champion",
          status: row.status,
        })
        .select("id")
        .maybeSingle();
      if (ad?.id) {
        await supabase.from("smart_links").update({ ad_id: ad.id }).eq("code", row.smartLinkCode);
      }
    },

    async audit(businessId, action, detail) {
      await supabase.from("journal_entries").insert({
        business_id: businessId,
        entry_type: "note",
        content: { action, detail },
      });
    },
  };
}

/**
 * Pure: which of a business's ads should be stopped when `keep` goes live.
 *
 * Retirement is tracked by `retiredAt`, NOT by `status`. The launcher writes
 * 'launched' / 'awaiting_payment' / 'error' into status, which records how the
 * launch went -- an outcome. An earlier version of this function wrote
 * 'PAUSED' into that same column, which mixed an outcome vocabulary with a
 * state one and threw away the fact that the ad had launched at all.
 *
 * Three filters, each load-bearing:
 *  - no platformAdId: never reached the network (awaiting_payment, error), so
 *    there is nothing to pause.
 *  - in `keep`: retiring the ad you just launched would leave the account with
 *    nothing running.
 *  - already retired: a retry must not churn.
 */
export function adsToRetire(
  existing: { platformAdId: string | null; retiredAt: string | null }[],
  keep: readonly string[],
): string[] {
  const keeping = new Set(keep);
  return existing
    .filter((a): a is { platformAdId: string; retiredAt: string | null } => Boolean(a.platformAdId))
    .filter((a) => !keeping.has(a.platformAdId))
    .filter((a) => a.retiredAt === null)
    .map((a) => a.platformAdId);
}

/**
 * Stop everything except the ads just launched. Sequential tiers only.
 *
 * WHY ONLY SEQUENTIAL TIERS. A duel is supposed to run its champion and
 * challengers at the same time, so retiring the others there would break the
 * product. Spark is the opposite: one budget, one ad, and the whole comparison
 * depends on the runs NOT overlapping.
 *
 * THE ORDER MATTERS AND IS THE POINT. Meta is paused first, and our row is
 * only updated for ads Meta confirmed. Writing our row first, or writing it
 * regardless, would leave the database saying "paused" while the ad kept
 * spending the customer's money -- a lie in the direction that costs them.
 * Each ad is attempted independently so one failure cannot strand the rest.
 */
export async function retirePreviousAds(
  supabase: SupabaseClient,
  cfg: MetaConfig,
  businessId: string,
  keep: readonly string[],
): Promise<{ paused: string[]; failed: { adId: string; error: string }[] }> {
  const { data } = await supabase
    .from("ads")
    .select("platform_ad_id, retired_at, campaigns!inner(business_id)")
    .eq("campaigns.business_id", businessId)
    .is("retired_at", null);

  const targets = adsToRetire(
    ((data ?? []) as { platform_ad_id: string | null; retired_at: string | null }[]).map((a) => ({
      platformAdId: a.platform_ad_id,
      retiredAt: a.retired_at,
    })),
    keep,
  );

  const paused: string[] = [];
  const failed: { adId: string; error: string }[] = [];
  for (const adId of targets) {
    try {
      await pauseAd(cfg, adId);
      paused.push(adId);
    } catch (e) {
      // retired_at stays null on purpose: the ad IS still running, and
      // recording otherwise would hide a live, spending ad from every sweep
      // that looks for one.
      failed.push({ adId, error: (e as Error).message });
    }
  }

  if (paused.length > 0) {
    // status is left alone: it records that the launch succeeded, which stays
    // true after the ad is stopped. retired_at is the state.
    await supabase
      .from("ads")
      .update({ retired_at: new Date().toISOString(), is_champion: false })
      .in("platform_ad_id", paused);
  }

  await supabase.from("journal_entries").insert({
    business_id: businessId,
    entry_type: "note",
    content: {
      action: "ads_retired",
      detail: { kept: keep, paused, failed },
    },
  });

  return { paused, failed };
}
