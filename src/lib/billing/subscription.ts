/**
 * Subscription provisioning (Phase 4). Maps a chosen tier to the concrete quota
 * row (render cap, socials, platforms, markup) and activates it on a business.
 * The config lookup is pure + tested; `activateSubscription` is the thin write
 * the payment webhook calls on a successful charge. No payment keys needed to
 * build or test this — only to *trigger* it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TierId = "starter" | "growth" | "scale";

export interface SubscriptionConfig {
  tier: TierId;
  rendersPerDay: number;
  socialsLimit: number;
  platforms: ("meta" | "tiktok" | "google")[];
  /** ad-spend markup in basis points (1500 = 15%) */
  spendMarkupBps: number;
}

// Initial caps — render/socials caps are tunable; markup + platforms are fixed
// by the pricing model (Starter 15%/Meta, Growth 12%/+TikTok, Scale 10%/+Google).
const CONFIG: Record<TierId, SubscriptionConfig> = {
  starter: { tier: "starter", rendersPerDay: 2, socialsLimit: 3, platforms: ["meta"], spendMarkupBps: 1500 },
  growth: { tier: "growth", rendersPerDay: 6, socialsLimit: 6, platforms: ["meta", "tiktok"], spendMarkupBps: 1200 },
  scale: { tier: "scale", rendersPerDay: 12, socialsLimit: 12, platforms: ["meta", "tiktok", "google"], spendMarkupBps: 1000 },
};

export function isTierId(v: string | null | undefined): v is TierId {
  return v === "starter" || v === "growth" || v === "scale";
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
