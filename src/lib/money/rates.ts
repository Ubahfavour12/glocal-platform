/**
 * FX rate provider — Blueprint §5.2 "dynamic rate refreshed hourly".
 * Source: open.er-api.com (free, keyless, refreshes daily upstream; good
 * enough until a paid provider with parallel-market NGN indices replaces it —
 * swap happens here only, the rest of the app consumes RateSnapshot).
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
import type { RateSnapshot } from "./fx";

const SOURCE = "https://open.er-api.com/v6/latest/USD";

interface ErApiResponse {
  result: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

/** Parse the provider payload into a RateSnapshot (pure, unit-tested). */
export function parseRateResponse(
  data: ErApiResponse,
  quote: string,
  fetchedAt: Date,
): RateSnapshot {
  if (data.result !== "success" || !data.rates) {
    throw new Error(`FX provider returned ${data.result ?? "malformed payload"}`);
  }
  const rate = data.rates[quote.toUpperCase()];
  if (!(typeof rate === "number" && rate > 0)) {
    throw new Error(`FX provider has no usable rate for ${quote}`);
  }
  return { quote: quote.toUpperCase(), rate, fetchedAt };
}

/** In-memory hourly cache — one upstream call per currency per hour per instance. */
const cache = new Map<string, RateSnapshot>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchUsdRate(
  quote: string,
  now: Date = new Date(),
): Promise<RateSnapshot> {
  const key = quote.toUpperCase();
  const cached = cache.get(key);
  if (cached && now.getTime() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }
  const res = await fetchWithTimeout(SOURCE, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`FX provider unreachable (${res.status})`);
  const snapshot = parseRateResponse((await res.json()) as ErApiResponse, key, now);
  cache.set(key, snapshot);
  return snapshot;
}
