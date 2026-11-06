/**
 * Subscription provisioning (Phase 4). Maps a chosen tier to the concrete quota
 * row (render cap, socials, platforms, markup) and activates it on a business.
 * The config lookup is pure + tested; `activateSubscription` is the thin write
 * the payment webhook calls on a successful charge. No payment keys needed to
 * build or test this — only to *trigger* it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The paid ladder, cheapest first.
 *
 * `starter` was retired 6 Nov 2026. It carried 2 renders/day while a video
 * costs 4 (VIDEO_CREDIT_WEIGHT), so video was not rare on that tier, it was
 * arithmetically impossible -- a paying tier that could never do the thing
 * customers most want. `spark` replaces it at the bottom at a price the micro
 * market can actually pay, and the entry *video* tier is now growth, which has
 * the credits to honour the claim.
 */
export type TierId = "spark" | "growth" | "scale";

export interface SubscriptionConfig {
  tier: TierId;
  rendersPerDay: number;
  socialsLimit: number;
  platforms: ("meta" | "tiktok" | "google")[];
  /** ad-spend markup in basis points (1500 = 15%) */
  spendMarkupBps: number;
}

// Repriced 6 Nov 2026 for the market this actually sells into. The old ladder
// ($39/$99/$249, 15/12/10%) was priced for a US SaaS buyer: Scale alone was
// roughly N370,000/month against a market that is overwhelmingly micro.
//
// Markup now RISES as the price falls (Spark 18%, Growth 15%, Scale 12%). That
// is not predatory, it is arithmetic: a low-volume account costs about the same
// to serve as a large one, so the fixed cost is a bigger share of a smaller
// number. The customer still pays less in absolute terms than anyone else could
// serve them for.
//
// Render caps interact with VIDEO_CREDIT_WEIGHT (4) in creative/quota.ts: a
// tier below 4 renders/day cannot produce video at all. Spark is deliberately
// below it and never claims otherwise; growth is the entry video tier.
const CONFIG: Record<TierId, SubscriptionConfig> = {
  spark: { tier: "spark", rendersPerDay: 2, socialsLimit: 3, platforms: ["meta"], spendMarkupBps: 1800 },
  growth: { tier: "growth", rendersPerDay: 6, socialsLimit: 6, platforms: ["meta", "tiktok"], spendMarkupBps: 1500 },
  scale: { tier: "scale", rendersPerDay: 12, socialsLimit: 12, platforms: ["meta", "tiktok", "google"], spendMarkupBps: 1200 },
};

export function isTierId(v: string | null | undefined): v is TierId {
  return v === "spark" || v === "growth" || v === "scale";
}

/** Pure: the quota row values for a tier. */
export function subscriptionConfigForTier(tier: TierId): SubscriptionConfig {
  return CONFIG[tier];
}

/**
 * Activate a paid tier on a business: upsert the subscription row and flip
 * businesses.plan. Called on a successful payment (Phase 4). `purchaseChannel`
 * defaults to "web" — the margin-safe path; only "ios_iap" when sold via Apple.
 */
export async function activateSubscription(
  supabase: SupabaseClient,
  businessId: string,
  tier: TierId,
  purchaseChannel: "web" | "ios_iap" = "web",
): Promise<void> {
  const cfg = subscriptionConfigForTier(tier);

  const { error: subErr } = await supabase.from("subscriptions").upsert(
    {
      business_id: businessId,
      tier: cfg.tier,
      renders_per_day: cfg.rendersPerDay,
      socials_limit: cfg.socialsLimit,
      platforms: cfg.platforms,
      spend_markup_bps: cfg.spendMarkupBps,
      purchase_channel: purchaseChannel,
      active: true,
    },
    { onConflict: "business_id" },
  );
  if (subErr) throw new Error(`subscription upsert failed: ${subErr.message}`);

  const { error: bizErr } = await supabase
    .from("businesses")
    .update({ plan: cfg.tier })
    .eq("id", businessId);
  if (bizErr) throw new Error(`plan update failed: ${bizErr.message}`);
}
