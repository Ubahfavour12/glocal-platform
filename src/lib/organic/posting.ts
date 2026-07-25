/**
 * Organic posting orchestration — Phase 2.4.
 * Schedules organic posts to the customer's connected channels on a calm
 * cadence (default one a day), respecting the subscription's socials limit.
 * Organic presence supports the paid ads; it never overwhelms the feed.
 *
 * Pure orchestration with injected deps, so it is fixture-tested offline and
 * lights up on real Metricool when the key + a connected brand exist.
 */

import type { SocialNetwork } from "@/lib/metricool/client";

export interface PostCandidate {
  conceptId: string;
  text: string;
  mediaUrls: string[];
}

export interface PostingPlan {
  /** networks connected + active for this business */
  networks: SocialNetwork[];
  /** organic posts already scheduled today */
  postedToday: number;
  /** cadence cap per day (default 1) */
  dailyLimit: number;
}

export interface ScheduledPost {
  conceptId: string;
  postId: string;
  networks: SocialNetwork[];
  publishAtIso: string;
}

export interface PostingDeps {
  schedule(
    post: { text: string; mediaUrls: string[]; networks: SocialNetwork[] },
    publishAtIso: string,
  ): Promise<{ postId: string }>;
  record(businessId: string, scheduled: ScheduledPost): Promise<void>;
  audit?(businessId: string, action: string, detail: unknown): Promise<void>;
}

export interface PostingSummary {
  scheduled: ScheduledPost[];
  skippedForCadence: number;
  skippedNoNetworks: boolean;
  failed: { conceptId: string; error: string }[];
}

/** Spread posts a few hours apart from a mid-morning start, so they don't burst. */
export function publishTimes(count: number, now: Date): string[] {
  const out: string[] = [];
  const start = new Date(now);
  start.setUTCHours(9, 0, 0, 0); // ~mid-morning UTC
  if (start.getTime() <= now.getTime()) start.setTime(now.getTime() + 30 * 60_000);
  for (let i = 0; i < count; i++) {
    out.push(new Date(start.getTime() + i * 4 * 3_600_000).toISOString());
  }
  return out;
}

export async function scheduleOrganic(
  businessId: string,
  candidates: PostCandidate[],
  plan: PostingPlan,
  deps: PostingDeps,
  now: Date = new Date(),
): Promise<PostingSummary> {
  if (plan.networks.length === 0) {
    return { scheduled: [], skippedForCadence: 0, skippedNoNetworks: true, failed: [] };
  }

  const room = Math.max(0, plan.dailyLimit - plan.postedToday);
  const toPost = candidates.slice(0, room);
  const skippedForCadence = candidates.length - toPost.length;
  const times = publishTimes(toPost.length, now);

  const scheduled: ScheduledPost[] = [];
  const failed: { conceptId: string; error: string }[] = [];

  for (let i = 0; i < toPost.length; i++) {
    const c = toPost[i];
    try {
      const { postId } = await deps.schedule(
        { text: c.text, mediaUrls: c.mediaUrls, networks: plan.networks },
        times[i],
      );
      const rec: ScheduledPost = {
        conceptId: c.conceptId,
        postId,
        networks: plan.networks,
        publishAtIso: times[i],
      };
      await deps.record(businessId, rec);
      scheduled.push(rec);
    } catch (e) {
      failed.push({ conceptId: c.conceptId, error: (e as Error).message.slice(0, 160) });
    }
  }

  const summary: PostingSummary = { scheduled, skippedForCadence, skippedNoNetworks: false, failed };
  await deps.audit?.(businessId, "organic_scheduled", {
    scheduled: scheduled.length,
    skippedForCadence,
    failed: failed.length,
  });
  return summary;
}
