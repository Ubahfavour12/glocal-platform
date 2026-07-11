/**
 * Research Agent — YouTube scraper (Blueprint: Research Engine, PRD F-03).
 * Hybrid discovery: broad niche keywords + specific competitor handles.
 * Output feeds the reverse-engineering step that produces the 50-concept
 * pipeline. Trending results are cacheable per niche so customers in the
 * same space share one scrape (TRD §3 quota note).
 *
 * Quota costs: search.list = 100 units, videos.list / channels.list = 1.
 * Free daily quota 10,000 units → keyword searches are the scarce resource.
 */

const API = "https://www.googleapis.com/youtube/v3";

export interface ViralVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: Date;
  views: number;
  likes: number;
  durationSeconds: number;
  /** views per day since publish — the ranking signal */
  viralityScore: number;
  source: "keyword" | "competitor";
  sourceQuery: string;
}

export interface NicheScrapeRequest {
  /** Broad industry terms, e.g. ["skincare ad", "skincare commercial"] */
  keywords: string[];
  /** YouTube handles without @, e.g. ["cerave"] */
  competitorHandles: string[];
  /** Only consider videos newer than this many days (default 90). */
  maxAgeDays?: number;
}

// ---------- pure logic (unit-tested) ----------

/** Views per day since publish; day floor of 1 so brand-new videos don't divide by zero. */
export function viralityScore(views: number, publishedAt: Date, now: Date): number {
  const days = Math.max(1, (now.getTime() - publishedAt.getTime()) / 86_400_000);
  return views / days;
}

/** ISO-8601 duration ("PT1M30S") → seconds. */
export function parseDuration(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

/** Dedupe by videoId (keyword + competitor scrapes overlap), keep highest score, take top N. */
export function rankTop(videos: ViralVideo[], n = 50): ViralVideo[] {
  const byId = new Map<string, ViralVideo>();
  for (const v of videos) {
    const existing = byId.get(v.videoId);
    if (!existing || v.viralityScore > existing.viralityScore) byId.set(v.videoId, v);
  }
  return [...byId.values()].sort((a, b) => b.viralityScore - a.viralityScore).slice(0, n);
}

// ---------- API calls ----------

async function yt<T>(path: string, params: Record<string, string>, apiKey: string): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

interface SearchItem {
  id: { videoId: string };
}
interface VideoItem {
  id: string;
  snippet: { title: string; channelTitle: string; publishedAt: string };
  statistics: { viewCount?: string; likeCount?: string };
  contentDetails: { duration: string };
}

async function searchVideoIds(
  apiKey: string,
  params: Record<string, string>,
  publishedAfter: string,
): Promise<string[]> {
  const data = await yt<{ items: SearchItem[] }>(
    "search",
    {
      part: "snippet",
      type: "video",
      videoDuration: "short",
      order: "viewCount",
      maxResults: "25",
      publishedAfter,
      ...params,
    },
    apiKey,
  );
  return data.items.map((i) => i.id.videoId).filter(Boolean);
}

async function hydrateVideos(
  apiKey: string,
  ids: string[],
  source: ViralVideo["source"],
  sourceQuery: string,
  now: Date,
): Promise<ViralVideo[]> {
  if (ids.length === 0) return [];
  const data = await yt<{ items: VideoItem[] }>(
    "videos",
    { part: "snippet,statistics,contentDetails", id: ids.join(",") },
    apiKey,
  );
  return data.items.map((v) => {
    const publishedAt = new Date(v.snippet.publishedAt);
    const views = Number(v.statistics.viewCount ?? 0);
    return {
      videoId: v.id,
      title: v.snippet.title,
      channelTitle: v.snippet.channelTitle,
      publishedAt,
      views,
      likes: Number(v.statistics.likeCount ?? 0),
      durationSeconds: parseDuration(v.contentDetails.duration),
      viralityScore: viralityScore(views, publishedAt, now),
      source,
      sourceQuery,
    };
  });
}

async function resolveChannelId(apiKey: string, handle: string): Promise<string | null> {
  const data = await yt<{ items?: { id: string }[] }>(
    "channels",
    { part: "id", forHandle: handle },
    apiKey,
  );
  return data.items?.[0]?.id ?? null;
}

/**
 * The hybrid scrape (Strategy Studio Q4 decision): broad keyword discovery
 * plus direct competitor channels, merged and ranked to the top 50.
 */
export async function scrapeNiche(
  apiKey: string,
  req: NicheScrapeRequest,
  now: Date = new Date(),
): Promise<ViralVideo[]> {
  const maxAgeDays = req.maxAgeDays ?? 90;
  const publishedAfter = new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString();
  const all: ViralVideo[] = [];

  for (const keyword of req.keywords) {
    const ids = await searchVideoIds(apiKey, { q: keyword }, publishedAfter);
    all.push(...(await hydrateVideos(apiKey, ids, "keyword", keyword, now)));
  }

  for (const handle of req.competitorHandles) {
    const channelId = await resolveChannelId(apiKey, handle);
    if (!channelId) continue;
    const ids = await searchVideoIds(apiKey, { channelId }, publishedAfter);
    all.push(...(await hydrateVideos(apiKey, ids, "competitor", `@${handle}`, now)));
  }

  return rankTop(all, 50);
}
