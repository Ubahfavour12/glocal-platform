/**
 * Rate limiting for the endpoints that spend OUR money.
 *
 * The threat here is not a sophisticated attacker. It is a loop — a retry bug,
 * a stuck button, a curious person — hitting a route that calls Anthropic or a
 * render engine. Those routes turn requests into invoices, so the damage from
 * an unlimited one is a bill rather than an outage, and a bill arrives a month
 * after anyone could have noticed.
 *
 * Counting lives in Postgres because this app is serverless: every invocation
 * is a fresh process, so an in-memory counter limits exactly one request. The
 * round trip is what the limit costs to actually apply.
 *
 * FAILS OPEN, DELIBERATELY. If the limiter itself errors, the request is
 * allowed. A limiter that takes the product down when the counter misbehaves
 * has converted a billing risk into an outage, which is a worse trade — these
 * routes are guarded by auth and ownership checks regardless. The failure is
 * logged so it cannot stay invisible.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { createServiceClient } from "@/lib/supabase/server";

export interface Limit {
  /** Requests permitted per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * The limits, in one place so they can be read as a policy rather than hunted
 * for across routes. Generous enough that no real person meets them; tight
 * enough that a loop is stopped within seconds.
 */
export const LIMITS = {
  /** Rewrites tomorrow's ads. Anthropic on every call. */
  regenerate: { max: 10, windowSeconds: 3600 },
  /** Free-text questions to the agent. Anthropic on every call. */
  agentAsk: { max: 30, windowSeconds: 3600 },
  /** Studio saves. Cheap individually, but it is a text box anyone can hold down. */
  studioSave: { max: 60, windowSeconds: 3600 },
  /** Opening a checkout. Creates a PSP transaction each time. */
  checkout: { max: 20, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

export interface LimitResult {
  allowed: boolean;
  /** Hits in this window including the current one; null when the check failed. */
  count: number | null;
}

/**
 * Count one hit and say whether it may proceed.
 *
 * `subject` scopes the bucket — a user id, so one customer's loop cannot lock
 * everyone else out of the same route. Never pass an unauthenticated,
 * caller-controlled value: an attacker who picks their own bucket has no limit.
 */
export async function checkRateLimit(
  name: LimitName,
  subject: string,
  /** Injectable for tests. Production always uses the service client below. */
  client?: SupabaseClient,
): Promise<LimitResult> {
  const limit = LIMITS[name];
  try {
    // The SERVICE client, not the caller's. `bump_rate_limit` is granted to
    // service_role alone, and deliberately: a client that could call it
    // directly could burn through another customer's quota by naming their
    // bucket, turning a rate limiter into a denial-of-service tool.
    const supabase = client ?? createServiceClient();
    const { data, error } = await supabase.rpc("bump_rate_limit", {
      p_bucket: `${name}:${subject}`,
      p_window_seconds: limit.windowSeconds,
    });
    if (error) throw new Error(error.message);
    const count = Number(data);
    if (!Number.isFinite(count)) throw new Error("rate limiter returned no count");
    return { allowed: count <= limit.max, count };
  } catch (e) {
    log.error("ratelimit.unavailable", { name, subject, error: e });
    return { allowed: true, count: null };
  }
}

/** Seconds until this window resets, for a Retry-After header. */
export function retryAfterSeconds(name: LimitName, now: Date = new Date()): number {
  const w = LIMITS[name].windowSeconds;
  const elapsed = Math.floor(now.getTime() / 1000) % w;
  return w - elapsed;
}
