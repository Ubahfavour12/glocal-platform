/**
 * Live organic posting — binds the posting orchestration to Metricool and
 * Supabase (social_connections + journal). Dormant until the Metricool key
 * and a connected, active brand exist; otherwise it no-ops cleanly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  metricoolConfigFromEnv,
  normalizeNetworks,
  schedulePost,
  type MetricoolConfig,
  type SocialNetwork,
} from "@/lib/metricool/client";
import {
  scheduleOrganic,
  type PostCandidate,
  type PostingDeps,
  type PostingSummary,
} from "./posting";

const DAILY_ORGANIC_LIMIT = 1;

interface ConnectedBrand {
  brandRef: string;
  networks: SocialNetwork[];
}

/** The business's active Metricool brand + its connected networks, if any. */
async function getConnectedBrand(
  supabase: SupabaseClient,
  businessId: string,
): Promise<ConnectedBrand | null> {
  const { data } = await supabase
    .from("social_connections")
    .select("network, metricool_brand_ref, status")
    .eq("business_id", businessId)
    .eq("status", "active");
  if (!data || data.length === 0) return null;
  const brandRef = data.find((r) => r.metricool_brand_ref)?.metricool_brand_ref as
    | string
    | undefined;
  if (!brandRef) return null;
  const networks = normalizeNetworks(data.map((r) => r.network as string));
  if (networks.length === 0) return null;
  return { brandRef, networks };
}

async function countPostedToday(supabase: SupabaseClient, businessId: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("entry_type", "note")
    .gte("created_at", since.toISOString())
    .contains("content", { action: "organic_post" });
  return count ?? 0;
}

/**
 * Schedule the business's organic post(s) for today from the given candidates.
 * Returns a summary; the "no brand / no key" cases are treated as a clean skip.
 */
export async function scheduleOrganicForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  candidates: PostCandidate[],
  now: Date = new Date(),
): Promise<PostingSummary | { skipped: string }> {
  let cfg: MetricoolConfig;
  try {
    cfg = metricoolConfigFromEnv();
  } catch {
    return { skipped: "metricool_not_configured" };
  }
  const brand = await getConnectedBrand(supabase, businessId);
  if (!brand) return { skipped: "no_active_brand" };

  const postedToday = await countPostedToday(supabase, businessId);

  const deps: PostingDeps = {
    schedule: (post, publishAtIso) =>
      schedulePost(cfg, brand.brandRef, post, publishAtIso),
    record: async (bizId, scheduled) => {
      await supabase.from("journal_entries").insert({
        business_id: bizId,
        entry_type: "note",
        content: {
          action: "organic_post",
          conceptId: scheduled.conceptId,
          postId: scheduled.postId,
          networks: scheduled.networks,
          publishAt: scheduled.publishAtIso,
        },
      });
    },
    audit: async (bizId, action, detail) => {
      await supabase.from("journal_entries").insert({
        business_id: bizId,
        entry_type: "note",
        content: { action, detail },
      });
    },
  };

  return scheduleOrganic(
    businessId,
    candidates,
    { networks: brand.networks, postedToday, dailyLimit: DAILY_ORGANIC_LIMIT },
    deps,
    now,
  );
}
