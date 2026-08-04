/**
 * Ad-spend → wallet bridge (Phase 4). The atomic money-move lives in the DB
 * function `record_spend` (migration 0002): it writes the paired `ad_spend` +
 * `markup_fee` ledger entries together and refuses to overdraw the balance.
 * This module resolves the two inputs that function needs — the wallet and the
 * business's markup rate — from a business id, so the (future) live spend-sync
 * calls a single function per delivered-spend delta.
 *
 * The markup rate comes from the active subscription. If a paid business somehow
 * has no subscription row we fall back to the Starter rate so we never
 * under-charge. Free businesses never reach here — they can't launch ads (see
 * the launch paywall guard).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Starter-tier markup — the safe default when no subscription row is found. */
export const DEFAULT_MARKUP_BPS = 1500;

/** Pure: a subscription's markup in bps, or the default when absent/invalid. */
export function markupBpsOrDefault(raw: number | null | undefined): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 3000
    ? raw
    : DEFAULT_MARKUP_BPS;
}

/**
 * Record `spendUsdMinor` of delivered ad spend for a business, applying its
 * per-tier markup atomically. Throws if the wallet is missing or the DB balance
 * guard trips (spend + fee exceeds balance). Deduplicating spend deltas so the
 * same delivered spend is not recorded twice is the caller's responsibility.
 */
export async function recordAdSpend(
  supabase: SupabaseClient,
  businessId: string,
  spendUsdMinor: number,
  campaignRef: string | null = null,
): Promise<void> {
  if (!Number.isInteger(spendUsdMinor) || spendUsdMinor <= 0) {
    throw new Error("spend must be a positive integer of USD minor units");
  }

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!wallet?.id) throw new Error(`no wallet for business ${businessId}`);

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("spend_markup_bps")
    .eq("business_id", businessId)
    .maybeSingle();
  const markupBps = markupBpsOrDefault(sub?.spend_markup_bps as number | null | undefined);

  const { error } = await supabase.rpc("record_spend", {
    p_wallet_id: wallet.id,
    p_spend_usd_minor: spendUsdMinor,
    p_markup_bps: markupBps,
    p_campaign_ref: campaignRef,
  });
  if (error) throw new Error(`record_spend failed: ${error.message}`);
}
