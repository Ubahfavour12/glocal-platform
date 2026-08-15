/**
 * Live LaunchAdapters — binds the morning launcher to the Meta client and
 * Supabase. Resolves (or creates) the child ad account, page, and campaign,
 * mints smart links from the business's connection door, and creates every
 * Meta object PAUSED. Meta's no-payment-method block (1359188) is caught and
 * reported as awaiting_payment, never thrown.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createLinkAdCreative,
  createPausedAd,
  createPausedAdSet,
  createPausedCampaign,
  metaConfigFromEnv,
  objectiveForGoal,
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
