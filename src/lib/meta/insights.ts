/**
 * Meta insights ingestion — Slice C (TRD §4.2 daytime monitors).
 * Pulls real per-ad daily metrics from the Meta Marketing API and maps them
 * into the shapes the verdict and fatigue engines already consume. Parsing is
 * pure and fixture-tested; the fetch shape mirrors meta/client.ts.
 *
 * The verdict engine wants CandidateMetrics (impressions, clicks, intents,
 * spend, revenue per day). The fatigue engine wants CTR + frequency. Both
 * come from the same insights row, so we parse once and derive both.
 */

import type { MetaConfig } from "./client";
import type { CandidateMetrics, DailyMetrics } from "@/lib/verdicts/verdict";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Raw insights row as Meta returns it (fields we request, time_increment=1). */
export interface RawInsightRow {
  ad_id: string;
  date_start: string; // YYYY-MM-DD
  impressions?: string;
  clicks?: string;
  spend?: string; // major units, e.g. "1.53"
  ctr?: string; // percent, e.g. "1.24"
  frequency?: string; // avg impressions per person
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

export interface AdDayMetrics {
  adId: string;
  date: Date;
  impressions: number;
  clicks: number;
  spendUsdMinor: number;
  ctr: number; // fraction, 0..1
  frequency: number | null;
  intents: number; // conversion-intent actions (link clicks / messaging / leads)
  revenueUsdMinor: number; // purchase value when a store is connected
}

/** Action types that count as a conversion intent (CPCI numerator events). */
const INTENT_ACTIONS = new Set([
  "link_click",
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
  "lead",
  "landing_page_view",
]);
const PURCHASE_ACTIONS = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);

function sumActions(list: { action_type: string; value: string }[] | undefined, keep: Set<string>): number {
  if (!list) return 0;
  return list.reduce((s, a) => (keep.has(a.action_type) ? s + Number(a.value || 0) : s), 0);
}

/** Pure: normalise a raw insights row. CTR from Meta is a percent; store fraction. */
export function parseInsightRow(raw: RawInsightRow): AdDayMetrics {
  const impressions = Number(raw.impressions ?? 0);
  const clicks = Number(raw.clicks ?? 0);
  // prefer Meta's ctr if present, else derive; both as a fraction
  const ctr = raw.ctr !== undefined ? Number(raw.ctr) / 100 : impressions > 0 ? clicks / impressions : 0;
  const freq = raw.frequency !== undefined ? Number(raw.frequency) : null;
  const intents = sumActions(raw.actions, INTENT_ACTIONS);
  const revenueMajor = sumActions(raw.action_values, PURCHASE_ACTIONS);
  return {
    adId: raw.ad_id,
    date: new Date(raw.date_start + "T00:00:00Z"),
    impressions,
    clicks,
    spendUsdMinor: Math.round(Number(raw.spend ?? 0) * 100),
    ctr,
    frequency: Number.isFinite(freq as number) ? freq : null,
    intents,
    revenueUsdMinor: Math.round(revenueMajor * 100),
  };
}

/** Group normalised rows into the verdict engine's CandidateMetrics per ad. */
export function toCandidateMetrics(
  rows: AdDayMetrics[],
  startedAt: Map<string, Date>,
): CandidateMetrics[] {
  const byAd = new Map<string, DailyMetrics[]>();
  for (const r of rows) {
    const daily: DailyMetrics = {
      date: r.date,
      impressions: r.impressions,
      clicks: r.clicks,
      intents: r.intents,
      spendUsdMinor: r.spendUsdMinor,
      revenueUsdMinor: r.revenueUsdMinor,
    };
    const arr = byAd.get(r.adId) ?? [];
    arr.push(daily);
    byAd.set(r.adId, arr);
  }
  return [...byAd.entries()].map(([adId, daily]) => ({
    adId,
    startedAt: startedAt.get(adId) ?? daily[0]?.date ?? new Date(),
    daily,
  }));
}

// ---------- live fetch (structure mirrors meta/client.ts) ----------

interface InsightsResponse {
  data?: RawInsightRow[];
  error?: { message: string };
}

export async function fetchAdInsights(
  cfg: MetaConfig,
  adAccountId: string,
  sinceIso: string,
  untilIso: string,
): Promise<AdDayMetrics[]> {
  const url = new URL(`${GRAPH}/${adAccountId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set(
    "fields",
    "ad_id,impressions,clicks,spend,ctr,frequency,actions,action_values",
  );
  url.searchParams.set("time_range", JSON.stringify({ since: sinceIso, until: untilIso }));
  url.searchParams.set("access_token", cfg.accessToken);

  const res = await fetch(url);
  const data = (await res.json()) as InsightsResponse;
  if (data.error) throw new Error(`Meta insights ${adAccountId}: ${data.error.message}`);
  return (data.data ?? []).map(parseInsightRow);
}
