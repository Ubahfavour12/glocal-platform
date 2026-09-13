import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXCERPT_LENGTH, excerpt, hashInput, recordGeneration, toRow } from "./generation-log";

afterEach(() => vi.restoreAllMocks());

const base = {
  businessId: "b1",
  provider: "fal",
  model: "flux/dev",
  kind: "image" as const,
};

describe("what the log keeps, and what it refuses to keep", () => {
  it("stores a hash and a short excerpt, never the whole prompt", () => {
    // Storing every brief verbatim would make this table a second copy of each
    // customer's strategy — a disclosure risk created in the name of compliance.
    const long = "secret positioning. ".repeat(200);
    const row = toRow({ ...base, input: long });
    expect(String(row.input_excerpt).length).toBeLessThanOrEqual(EXCERPT_LENGTH + 1);
    expect(row.input_sha256).toBe(hashInput(long));
  });

  it("hashes identically for identical input, so a complaint can be matched", () => {
    expect(hashInput("a brief")).toBe(hashInput("a brief"));
    expect(hashInput("a brief")).not.toBe(hashInput("another brief"));
  });

  it("collapses whitespace in the excerpt so it stays readable in a table", () => {
    expect(excerpt("a\n\n  b\tc")).toBe("a b c");
  });

  it("keeps a short input whole and unmarked", () => {
    expect(excerpt("short brief")).toBe("short brief");
  });

  it("records the specific model, not just the vendor", () => {
    // "fal" does not answer "which model wrote this".
    expect(toRow(base)).toMatchObject({ provider: "fal", model: "flux/dev" });
  });

  it("treats an empty or whitespace input as no input rather than hashing nothing", () => {
    expect(toRow({ ...base, input: "   " })).toMatchObject({
      input_sha256: null,
      input_excerpt: null,
    });
  });

  it("carries the optional fields through", () => {
    expect(toRow({ ...base, creativeId: "c1", outputRef: "u", costUsdMinor: 40 })).toMatchObject({
      creative_id: "c1",
      output_ref: "u",
      cost_usd_minor: 40,
    });
  });
});

describe("recordGeneration", () => {
  const client = (insert: () => Promise<{ error: unknown }>) =>
    ({ from: () => ({ insert }) }) as unknown as SupabaseClient;

  it("reports success when the row lands", async () => {
    expect(await recordGeneration(client(async () => ({ error: null })), base)).toEqual({
      recorded: true,
    });
  });

  it("NEVER throws, so a logging failure cannot stop a render", async () => {
    // A creative made but not logged is a gap in evidence. A creative that
    // failed because the log was down is a broken product.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = client(async () => ({ error: { message: "table missing" } }));
    await expect(recordGeneration(broken, base)).resolves.toEqual({ recorded: false });
    expect(spy.mock.calls[0][0]).toContain("generation.log_failed");
  });

  it("survives the client throwing outright", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const thrower = { from: () => { throw new Error("no connection"); } } as unknown as SupabaseClient;
    await expect(recordGeneration(thrower, base)).resolves.toEqual({ recorded: false });
  });
});
