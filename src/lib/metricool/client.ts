/**
 * Metricool client — Phase 2.4 (Blueprint §3 "organic distribution").
 * Schedules organic posts to the customer's connected social channels, so the
 * agent builds presence alongside the paid ads. Thin, typed wrapper; the pure
 * payload/network helpers are fixture-tested and the network shape is
 * confirmed at integration (same confirm-at-purchase approach as pricing).
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
const BASE = "https://app.metricool.com/api";

export interface MetricoolConfig {
  userToken: string;
  userId: string;
}

export function metricoolConfigFromEnv(): MetricoolConfig {
  const userToken = process.env.METRICOOL_USER_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  if (!userToken || !userId) throw new Error("METRICOOL_USER_TOKEN / METRICOOL_USER_ID not configured");
  return { userToken, userId };
}

export type SocialNetwork =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "twitter"
  | "linkedin"
  | "youtube";

const SUPPORTED: Set<string> = new Set([
  "instagram",
  "facebook",
  "tiktok",
  "twitter",
  "linkedin",
  "youtube",
]);

/** Pure: keep only supported networks, lower-cased and de-duplicated. */
export function normalizeNetworks(networks: string[]): SocialNetwork[] {
  const seen = new Set<string>();
  const out: SocialNetwork[] = [];
  for (const n of networks) {
    const key = n.trim().toLowerCase();
    if (SUPPORTED.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key as SocialNetwork);
    }
  }
  return out;
}

export interface OrganicPost {
  text: string;
  mediaUrls: string[];
  networks: SocialNetwork[];
}

export interface SchedulePayload {
  text: string;
  providers: { network: SocialNetwork }[];
  media: string[];
  publicationDate: { dateTime: string; timezone: string };
  autoPublish: boolean;
}

/** Pure: build the schedule-post body. Throws on empty text or no networks. */
export function buildPostPayload(
  post: OrganicPost,
  publishAtIso: string,
  timezone = "Africa/Lagos",
): SchedulePayload {
  if (!post.text.trim()) throw new Error("organic post text is empty");
  if (post.networks.length === 0) throw new Error("organic post has no networks");
  return {
    text: post.text.trim(),
    providers: post.networks.map((network) => ({ network })),
    media: post.mediaUrls.filter((m) => /^https?:\/\//i.test(m)),
    publicationDate: { dateTime: publishAtIso, timezone },
    autoPublish: true,
  };
}

interface ScheduleResponse {
  id?: string | number;
  data?: { id?: string | number };
  error?: string;
}

/** Schedule one organic post to a brand's connected networks. */
export async function schedulePost(
  cfg: MetricoolConfig,
  brandRef: string,
  post: OrganicPost,
  publishAtIso: string,
  timezone = "Africa/Lagos",
): Promise<{ postId: string }> {
  const url = new URL(`${BASE}/v1/scheduler/posts`);
  url.searchParams.set("blogId", brandRef);
  url.searchParams.set("userId", cfg.userId);
  url.searchParams.set("userToken", cfg.userToken);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPostPayload(post, publishAtIso, timezone)),
  });
  const data = (await res.json()) as ScheduleResponse & { message?: string };
  if (!res.ok || data.error) {
    throw new Error(`Metricool schedule failed: ${data.error ?? data.message ?? res.status}`);
  }
  const id = data.id ?? data.data?.id;
  if (id === undefined) throw new Error("Metricool: no post id returned");
  return { postId: String(id) };
}
