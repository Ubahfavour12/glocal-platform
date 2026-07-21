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
import type { CandidateMetrics } from "@/lib/verdicts/verdict";
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
        frequency: null,
        intents: 0,
        revenueUsdMinor: rev.revenueUsdMinor,
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
