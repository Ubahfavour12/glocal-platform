/**
 * Live organic posting — now runs on OUR Meta integration (direct OAuth),
 * not a paid middleman. Uses the page/IG tokens the connect flow stored in
 * social_connections to publish via the Graph API. Dormant until the customer
 * has connected a Facebook/Instagram account; otherwise a clean skip.
 *
 * (Metricool remains available as a dogfood shortcut but is no longer the
 * default path — this is the durable, $0-per-account answer.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeNetworks, type SocialNetwork } from "@/lib/metricool/client";
import { publishToFacebook, publishToInstagram } from "@/lib/meta/publish";
import {
  scheduleOrganic,
  type PostCandidate,
  type PostingDeps,
  type PostingSummary,
} from "./posting";

const DAILY_ORGANIC_LIMIT = 1;

interface MetaConnection {
  network: SocialNetwork;
  accountId: string;
  token: string;
}

async function getMetaConnections(
  supabase: SupabaseClient,
  businessId: string,
): Promise<MetaConnection[]> {
  const { data } = await supabase
    .from("social_connections")
    .select("network, platform_account_id, access_token, status, provider")
    .eq("business_id", businessId)
    .eq("provider", "meta")
    .eq("status", "active");
  return (data ?? [])
    .filter((r) => r.platform_account_id && r.access_token)
    .map((r) => ({
      network: r.network as SocialNetwork,
      accountId: r.platform_account_id as string,
      token: r.access_token as string,
    }))
    .filter((c) => c.network === "facebook" || c.network === "instagram");
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

export async function scheduleOrganicForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  candidates: PostCandidate[],
  now: Date = new Date(),
): Promise<PostingSummary | { skipped: string }> {
  const connections = await getMetaConnections(supabase, businessId);
  if (connections.length === 0) return { skipped: "no_connected_account" };

  const networks = normalizeNetworks(connections.map((c) => c.network));
  const postedToday = await countPostedToday(supabase, businessId);

  const deps: PostingDeps = {
    // Publish immediately to each connected network; return a combined id.
    schedule: async (post) => {
      const ids: string[] = [];
      for (const conn of connections) {
        if (!networks.includes(conn.network)) continue;
        if (conn.network === "facebook") {
          const { postId } = await publishToFacebook(conn.accountId, conn.token, {
            message: post.text,
            imageUrl: post.mediaUrls[0],
          });
          ids.push(`fb:${postId}`);
        } else if (conn.network === "instagram" && post.mediaUrls[0]) {
          // Instagram needs an image; a text-only post skips it.
          const { postId } = await publishToInstagram(conn.accountId, conn.token, {
            caption: post.text,
            imageUrl: post.mediaUrls[0],
          });
          ids.push(`ig:${postId}`);
        }
      }
      if (ids.length === 0) throw new Error("no publishable network for this post");
      return { postId: ids.join(",") };
    },
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
    { networks, postedToday, dailyLimit: DAILY_ORGANIC_LIMIT },
    deps,
    now,
  );
}
