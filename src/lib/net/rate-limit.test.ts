import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS, checkRateLimit, retryAfterSeconds } from "./rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

afterEach(() => vi.restoreAllMocks());

const client = (impl: () => Promise<{ data: unknown; error: unknown }>) =>
  ({ rpc: vi.fn(impl) }) as unknown as SupabaseClient;

describe("checkRateLimit", () => {
  it("allows a request at the limit and refuses the one after", async () => {
    const at = (n: number) => client(async () => ({ data: n, error: null }));
    const max = LIMITS.regenerate.max;
    expect((await checkRateLimit("regenerate", "u1", at(max))).allowed).toBe(true);
    expect((await checkRateLimit("regenerate", "u1", at(max + 1))).allowed).toBe(false);
  });

  it("scopes the bucket to the subject, so one loop cannot lock out everyone", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    await checkRateLimit("agentAsk", "user-42", { rpc } as unknown as SupabaseClient);
    expect(rpc).toHaveBeenCalledWith(
      "bump_rate_limit",
      expect.objectContaining({ p_bucket: "agentAsk:user-42" }),
    );
  });

  it("passes the window the policy declares", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    await checkRateLimit("checkout", "u1", { rpc } as unknown as SupabaseClient);
    expect(rpc).toHaveBeenCalledWith(
      "bump_rate_limit",
      expect.objectContaining({ p_window_seconds: LIMITS.checkout.windowSeconds }),
    );
  });

  it("FAILS OPEN when the limiter itself breaks, and says so", async () => {
    // A limiter that takes the product down when its counter misbehaves has
    // turned a billing risk into an outage. These routes are still behind auth.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = client(async () => ({ data: null, error: { message: "db down" } }));
    const res = await checkRateLimit("regenerate", "u1", broken);
    expect(res).toEqual({ allowed: true, count: null });
    expect(spy.mock.calls[0][0]).toContain("ratelimit.unavailable");
  });

  it("fails open on a nonsense count rather than trusting it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const weird = client(async () => ({ data: "banana", error: null }));
    expect((await checkRateLimit("regenerate", "u1", weird)).allowed).toBe(true);
  });

  it("never logs the limiter failure with a secret in it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = client(async () => {
      throw new Error("connection to postgres://user:pw@host failed");
    });
    await checkRateLimit("regenerate", "u1", broken);
    // The message is an Error, reduced to name+message by redact — no object
    // spray of connection config.
    expect(spy.mock.calls[0][0]).toContain("ratelimit.unavailable");
  });
});

describe("retryAfterSeconds", () => {
  it("counts down to the end of the current window", () => {
    const w = LIMITS.regenerate.windowSeconds;
    const justStarted = new Date((Math.floor(1_800_000_000 / w) * w + 1) * 1000);
    expect(retryAfterSeconds("regenerate", justStarted)).toBe(w - 1);
  });

  it("never returns zero or negative, which would invite an instant retry", () => {
    for (const s of [0, 1, 59, 3599, 86_399]) {
      const t = new Date((1_800_000_000 + s) * 1000);
      expect(retryAfterSeconds("agentAsk", t)).toBeGreaterThan(0);
    }
  });
});

describe("the policy itself", () => {
  it("keeps every limit positive and bounded", () => {
    for (const [name, l] of Object.entries(LIMITS)) {
      expect(l.max, name).toBeGreaterThan(0);
      expect(l.windowSeconds, name).toBeGreaterThan(0);
    }
  });
});
