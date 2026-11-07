import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_USAGE, type ClaudeUsage } from "./cost";
import { NO_METER, usageMeter, usageRow } from "./usage";

const usage = (over: Partial<ClaudeUsage> = {}): ClaudeUsage => ({
  ...EMPTY_USAGE,
  ...over,
});

/**
 * A Supabase stand-in that records the inserts and can be told to fail.
 *
 * `from().insert()` is the whole surface this module uses, so the fake is
 * small enough to be obviously correct, which matters more here than for most
 * fakes: the behaviour under test is what happens when the real one breaks.
 */
function fakeSupabase(opts: { fail?: "reject" | "throw" } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("llm_usage");
      return {
        insert(row: Record<string, unknown>) {
          if (opts.fail === "throw") throw new Error("connection refused");
          inserts.push(row);
          if (opts.fail === "reject") return Promise.reject(new Error("insert failed"));
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserts };
}

describe("usageRow", () => {
  it("prices the call and names the business and the step", () => {
    const row = usageRow(
      "biz-1",
      "concepts",
      "claude-haiku-5-5",
      usage({ inputTokens: 1000, outputTokens: 500 }),
    );
    expect(row).toEqual({
      business_id: "biz-1",
      model: "claude-haiku-5-5",
      purpose: "concepts",
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cost_usd_micros: 350,
    });
  });
});

describe("usageMeter", () => {
  it("records a call against the business that caused it", async () => {
    const { client, inserts } = fakeSupabase();
    const meter = usageMeter(client, "biz-1", "compliance");
    meter.sink("claude-sonnet-5", usage({ inputTokens: 2000, outputTokens: 300 }));
    await meter.flush();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      business_id: "biz-1",
      purpose: "compliance",
      cost_usd_micros: 2000 * 2 + 300 * 10,
    });
  });

  it("keeps two businesses' costs apart", async () => {
    // Why a meter is built per business rather than held globally: module-level
    // state in a serverless function serving concurrent requests is how one
    // customer's spend gets charged to another.
    const { client, inserts } = fakeSupabase();
    const a = usageMeter(client, "biz-a", "concepts");
    const b = usageMeter(client, "biz-b", "concepts");
    a.sink("claude-haiku-5-5", usage({ inputTokens: 100 }));
    b.sink("claude-haiku-5-5", usage({ inputTokens: 900 }));
    await Promise.all([a.flush(), b.flush()]);
    expect(inserts.map((r) => [r.business_id, r.input_tokens]).sort()).toEqual([
      ["biz-a", 100],
      ["biz-b", 900],
    ]);
  });

  it("records nothing when no tokens were spent", async () => {
    // A call that failed before reaching the model costs nothing, and a row
    // saying so is noise in a table whose only job is answering "how much".
    const { client, inserts } = fakeSupabase();
    const meter = usageMeter(client, "biz-1", "ask");
    meter.sink("claude-haiku-5-5", EMPTY_USAGE);
    await meter.flush();
    expect(inserts).toEqual([]);
  });

  it("swallows a rejected insert, because accounting must not break generation", async () => {
    const { client } = fakeSupabase({ fail: "reject" });
    const meter = usageMeter(client, "biz-1", "concepts");
    meter.sink("claude-sonnet-5", usage({ inputTokens: 10, outputTokens: 10 }));
    await expect(meter.flush()).resolves.toBeUndefined();
  });

  it("swallows a synchronous throw from the client too", async () => {
    // The rejected-promise path is the one people remember. A client that
    // throws on the call itself -- no network, bad config -- would otherwise
    // propagate straight out of the sink and kill the generation.
    const { client } = fakeSupabase({ fail: "throw" });
    const meter = usageMeter(client, "biz-1", "concepts");
    expect(() => meter.sink("claude-sonnet-5", usage({ inputTokens: 10 }))).toThrow();
    // ...which is why anthropic.ts wraps the sink call. Proven there; recorded
    // here so nobody "fixes" that wrapper away believing this layer catches it.
    await expect(meter.flush()).resolves.toBeUndefined();
  });

  it("flushing twice does not write twice", async () => {
    const { client, inserts } = fakeSupabase();
    const meter = usageMeter(client, "biz-1", "traits");
    meter.sink("claude-haiku-5-5", usage({ inputTokens: 50 }));
    await meter.flush();
    await meter.flush();
    expect(inserts).toHaveLength(1);
  });

  it("NO_METER records nothing and flushes clean", async () => {
    expect(() => NO_METER.sink("claude-haiku-5-5", usage({ inputTokens: 100 }))).not.toThrow();
    await expect(NO_METER.flush()).resolves.toBeUndefined();
  });
});
