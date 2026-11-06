/**
 * Live adapters — Slice C completion. Composes real Meta insights + DB rows
 * into the orchestrator's injected adapter interface. All data access is
 * behind LiveDeps so this composition is fully testable offline; the nightly
 * cron route implements the deps with Supabase + the Meta client.
 *
 * Attribution overlay: platform insights carry impressions/clicks/intents;
 * OUR conversions (mark-as-sold, pixel, store) carry verified revenue. The
 * two merge per ad per day, so the verdict engine sees one honest series.
 */

import type { AdDayMetrics } from "@/lib/meta/insights";
import { toCandidateMetrics } from "@/lib/meta/insights";
import type { CandidateMetrics, DailyMetrics } from "@/lib/verdicts/verdict";
import type { SequentialBlock } from "@/lib/verdicts/sequential";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal Supabase surface these helpers need. */
type Supa = SupabaseClient;
import { WINDOW_DAYS } from "@/lib/verdicts/verdict";
import type { FatigueInput } from "@/lib/verdicts/fatigue";
import { updatePeakCtr } from "@/lib/verdicts/fatigue";
import { revenueJudgingAllowed, type ConsistencyResult } from "@/lib/tracking/consistency";
import type { AttributedOrder } from "@/lib/tracking/attribution";

export interface OpenTestAd {
  /** our uuid */
  adId: string;
  platformAdId: string;
  startedAt: Date;
}

export interface AttributedRevenueRow {
  platformAdId: string;
  dateIso: string; // YYYY-MM-DD (UTC)
  revenueUsdMinor: number;
}

export interface ChampionRow {
  platformAdId: string;
  since: Date;
}

export interface LiveDeps {
  /** Per-ad daily metrics from the ad platform for the account. */
  fetchInsights(sinceIso: string, untilIso: string): Promise<AdDayMetrics[]>;
  /** The open A/B test's ads (champion + challengers). */
  listOpenTestAds(businessId: string): Promise<OpenTestAd[]>;
  /** Verified revenue per ad per day from OUR conversions (ad_code joined). */
  listAttributedRevenue(businessId: string, sinceIso: string): Promise<AttributedRevenueRow[]>;
  /** Attributed order timestamps for the consistency gate. */
  listAttributedOrderTimes(businessId: string, sinceIso: string): Promise<Date[]>;
  /** Current champion, when one exists. */
  getChampion(businessId: string): Promise<ChampionRow | null>;
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function windowSinceIso(now: Date): string {
  return isoDay(new Date(now.getTime() - (WINDOW_DAYS + 1) * DAY_MS));
}

/** Merge platform insights with our verified revenue, per ad per day. */
export function overlayRevenue(
  rows: AdDayMetrics[],
  revenue: AttributedRevenueRow[],
): AdDayMetrics[] {
  const byKey = new Map<string, AdDayMetrics>();
  for (const r of rows) byKey.set(`${r.adId}|${isoDay(r.date)}`, { ...r });
  for (const rev of revenue) {
    const key = `${rev.platformAdId}|${rev.dateIso}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.revenueUsdMinor += rev.revenueUsdMinor;
    } else {
      // a sale on a day the platform reported nothing — still counts
      byKey.set(key, {
        adId: rev.platformAdId,
        date: new Date(rev.dateIso + "T00:00:00Z"),
        impressions: 0,
        clicks: 0,
        spendUsdMinor: 0,
        ctr: 0,
        reach: null,
      frequency: null,
        intents: 0,
        revenueUsdMinor: rev.revenueUsdMinor,
        attention: { saves: 0, shares: 0, comments: 0, reactions: 0, thruPlays: 0 },
      });
    }
  }
  return [...byKey.values()];
}

export function buildLiveAdapters(deps: LiveDeps, now: Date = new Date()) {
  async function getOpenTestCandidates(businessId: string): Promise<CandidateMetrics[]> {
    const ads = await deps.listOpenTestAds(businessId);
    if (ads.length < 2) return [];
    const sinceIso = windowSinceIso(now);
    const platformIds = new Set(ads.map((a) => a.platformAdId));

    const [insights, revenue] = await Promise.all([
      deps.fetchInsights(sinceIso, isoDay(now)),
      deps.listAttributedRevenue(businessId, sinceIso),
    ]);
    const merged = overlayRevenue(
      insights.filter((r) => platformIds.has(r.adId)),
      revenue.filter((r) => platformIds.has(r.platformAdId)),
    );

    const startedAt = new Map(ads.map((a) => [a.platformAdId, a.startedAt]));
    const byPlatformId = new Map(ads.map((a) => [a.platformAdId, a.adId]));
    // candidates keyed by OUR ad uuid so verdicts reference our rows
    return toCandidateMetrics(merged, startedAt).map((c) => ({
      ...c,
      adId: byPlatformId.get(c.adId) ?? c.adId,
    }));
  }

  async function getChampionState(businessId: string): Promise<FatigueInput | null> {
    const champ = await deps.getChampion(businessId);
    if (!champ) return null;
    const sinceIso = isoDay(champ.since);
    const rows = (await deps.fetchInsights(sinceIso, isoDay(now)))
      .filter((r) => r.adId === champ.platformAdId)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (rows.length === 0) return null;

    let peakCtr = 0;
    for (const r of rows) peakCtr = updatePeakCtr(peakCtr, r.ctr);
    const latest = rows[rows.length - 1];
    return {
      championSince: champ.since,
      peakCtr,
      currentCtr: latest.ctr,
      frequency: latest.frequency,
    };
  }

  /** Consistency gate over the same window the verdict judges. */
  async function revenueGate(businessId: string): Promise<ConsistencyResult> {
    const times = await deps.listAttributedOrderTimes(businessId, windowSinceIso(now));
    const orders: AttributedOrder[] = times.map((at) => ({
      code: "attributed",
      codeSource: "message",
      valueUsdMinor: 1,
      source: "manual",
      at,
    }));
    return revenueJudgingAllowed(orders, now);
  }

  return { getOpenTestCandidates, getChampionState, revenueGate };
}


/**
 * The last two runs of a sequential (Spark) account, oldest first.
 *
 * Blocks are DERIVED rather than stored: an ad's run starts at its
 * `created_at` and ends when the next ad starts (or now). The `ads` table
 * already carries that, and insights rows are already keyed by ad id and
 * date, so storing a second copy of the same fact would only create something
 * to keep in sync.
 *
 * Returns fewer than two when the account has not run two ads yet, which
 * `decideSequential` handles by staying pending.
 */
export async function sparkBlocks(
  supabase: Supa,
  businessId: string,
  rows: AdDayMetrics[],
): Promise<SequentialBlock[]> {
  const { data } = await supabase
    .from("ads")
    .select("platform_ad_id, created_at, campaigns!inner(business_id)")
    .eq("campaigns.business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(2);

  const ads = (data ?? []) as { platform_ad_id: string | null; created_at: string }[];
  const byAd = new Map<string, DailyMetrics[]>();
  for (const r of rows) {
    const arr = byAd.get(r.adId) ?? [];
    arr.push({
      date: r.date,
      impressions: r.impressions,
      clicks: r.clicks,
      intents: r.intents,
      spendUsdMinor: r.spendUsdMinor,
      revenueUsdMinor: r.revenueUsdMinor,
      reach: r.reach ?? undefined,
      attention: r.attention,
    });
    byAd.set(r.adId, arr);
  }

  return ads
    .filter((a): a is { platform_ad_id: string; created_at: string } => Boolean(a.platform_ad_id))
    .map((a) => ({ adId: a.platform_ad_id, daily: byAd.get(a.platform_ad_id) ?? [] }))
    .filter((b) => b.daily.length > 0)
    .reverse(); // oldest first, so the newest run is the one being judged
}

/**
 * How many ads this business has ever run.
 *
 * Counted from our own table rather than from insights, so the rotation clock
 * keeps ticking even on a night Meta does not answer. A rotation that stalled
 * because an upstream was down would quietly cost the customer a week.
 */
/**
 * How far back to pull insights for a sequential comparison.
 *
 * Wider than the duel's 3-day window because a block is a whole week and two
 * are compared: 30 days covers two 14-day blocks with slack, and over-fetching
 * is free here since aggregateBlock sums only the days an ad was actually live.
 */
export function sequentialSinceIso(now: Date): string {
  return new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
}

export function sequentialUntilIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function sparkAdCount(supabase: Supa, businessId: string): Promise<number> {
  const { count } = await supabase
    .from("ads")
    .select("id, campaigns!inner(business_id)", { count: "exact", head: true })
    .eq("campaigns.business_id", businessId);
  return count ?? 0;
}

/** When the newest ad went live, for the rotation clock. Null when none. */
export async function sparkLiveSince(supabase: Supa, businessId: string): Promise<Date | null> {
  const { data } = await supabase
    .from("ads")
    .select("created_at, campaigns!inner(business_id)")
    .eq("campaigns.business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = (data as { created_at?: string } | null)?.created_at;
  return at ? new Date(at) : null;
}
