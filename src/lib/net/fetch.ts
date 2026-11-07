/**
 * Every call that leaves this process, with a deadline on it.
 *
 * WHY THIS EXISTS. Before it, not one outbound `fetch` in the codebase had a
 * timeout — not Meta, not Anthropic, not fal, not Paystack, not the FX
 * provider. `fetch` has no default timeout, so a dependency that accepts the
 * connection and then stops answering does not fail: it hangs. Nothing retries,
 * nothing errors, nothing logs. The request simply never comes back.
 *
 * On serverless that is expensive in a specific way. The function keeps running
 * and keeps billing until `maxDuration` kills it — 300 seconds on the job
 * routes — and the caller waits the whole time. One unhealthy upstream in the
 * nightly run stalls every business behind it in the queue. A customer clicking
 * "top up" watches a spinner for five minutes and then gets nothing.
 *
 * A timeout converts that into a fast, honest failure the caller can handle,
 * which is the whole point: a dependency being down should cost one request,
 * not the process.
 *
 * This is the cheap half of a circuit breaker. A true breaker also stops
 * calling a service that is repeatedly failing; that needs shared state across
 * invocations, which serverless does not give us for free. The deadline is what
 * prevents the damage, so it comes first.
 */

/** Long enough for a slow-but-working API, short enough that nobody waits. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Generation and render calls legitimately take longer than an API read, so
 * they get their own budget rather than forcing the default up for everyone.
 */
export const LONG_TIMEOUT_MS = 120_000;

/**
 * Status codes worth trying again.
 *
 * All of them mean "not now", none mean "not ever": 408 and 425 are the
 * request arriving at a bad moment, 429 is a rate limit, 500/502/503/504 are
 * the far side having a bad second, and 529 is Anthropic's overloaded. A 400
 * or a 403 would return exactly the same answer on the second attempt and
 * retrying one only wastes the deadline.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/** Exponential, from 400ms, with jitter so retries do not synchronise. */
function backoffMs(attempt: number): number {
  const base = 400 * 2 ** (attempt - 1);
  return Math.round(base + Math.random() * 200);
}

export class TimeoutError extends Error {
  constructor(url: string | URL, ms: number) {
    // Names the host, never the full URL: query strings carry tokens, and this
    // message ends up in logs and sometimes in front of a customer.
    let host = "upstream";
    try {
      host = new URL(url).host;
    } catch {
      /* keep the fallback */
    }
    super(`${host} did not respond within ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * `fetch` with a deadline.
 *
 * Honours a caller's own `signal` as well as the deadline, so an outer abort
 * still works; whichever fires first wins. Always clears the timer, including
 * on failure, so a long-lived process does not accumulate them.
 */
export async function fetchWithTimeout(
  // `string | URL` because callers legitimately build URLs with searchParams,
  // and making each one call .toString() is friction that invites a bare fetch.
  url: string | URL,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, signal, ...rest } = init;

  /*
   * RETRIES ARE OPT-IN, AND THAT IS NOT TIMIDITY.
   *
   * A retry is only safe when a second attempt cannot do the thing twice. A
   * dropped response from Meta's ad-creation endpoint does not mean the ad was
   * not created, and retrying it buys the customer two ads on one budget. The
   * same is true of a payment capture. Those call sites pass nothing and keep
   * failing loudly.
   *
   * Where a repeat creates nothing -- reads, and generation calls that cost
   * tokens but cannot double-charge anyone -- a transient 503 should not cost
   * a customer their night, and those sites opt in.
   */
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      // The caller gave up while we were waiting out the backoff.
      if (signal?.aborted) break;
    }
    try {
      const res = await attemptOnce(url, { ...rest, timeoutMs, signal });
      if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
        // Drain the body before discarding the response, or the connection is
        // held open until it is garbage collected.
        void res.arrayBuffer().catch(() => undefined);
        lastError = new Error(`upstream returned ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      // A timeout or a dropped connection. Worth another go, unless the
      // caller cancelled -- that is a decision, not a failure.
      if (signal?.aborted) throw e;
      lastError = e;
      if (attempt === retries) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

/** One attempt, with the deadline. The retry loop above drives it. */
async function attemptOnce(
  url: string | URL,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;

  // Refuse an already-cancelled request explicitly rather than handing the
  // aborted signal to fetch and trusting it to reject. Real fetch does, but
  // relying on that leaves the contract implicit and the behaviour dependent
  // on a runtime detail — and it silently did nothing under test, which is
  // exactly how a hang gets shipped.
  if (signal?.aborted) {
    const e = new Error("request was cancelled before it started");
    e.name = "AbortError";
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    // Distinguish "we gave up waiting" from "the caller cancelled" and from a
    // genuine network error, because only the first is our deadline firing and
    // only it should read as a timeout in the logs.
    const aborted = (e as Error)?.name === "AbortError";
    if (aborted && !signal?.aborted) throw new TimeoutError(url, timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
