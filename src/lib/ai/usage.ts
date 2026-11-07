/**
 * Record what a Claude call cost, against the business that caused it.
 *
 * `anthropic.ts` reports usage through a sink; this is the sink that writes it
 * down. Kept separate so the API client knows nothing about Supabase, and so
 * the arithmetic in `cost.ts` can be tested without either.
 *
 * TWO RULES, both of which this module exists to enforce.
 *
 * 1. A FAILED COST WRITE MUST NEVER FAIL A GENERATION. If the insert errors,
 *    the row is lost and the ad is still made. The alternative — a customer's
 *    nightly run dying because an accounting table was unreachable — is
 *    indefensible for a number only we look at.
 * 2. THE WRITES MUST STILL LAND. Rule 1 invites a floating promise, and on a
 *    serverless platform a floating promise is a promise the runtime may kill
 *    the moment the handler returns. So every insert is tracked and `flush()`
 *    waits for them. Long-running callers (the nightly job, the pipeline
 *    route) await it; nobody has to, and nothing breaks if they forget.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaudeUsageSink } from "./anthropic";
import { llmCostUsdMicros, type ClaudeUsage } from "./cost";

/**
 * Which step of the agent spent the tokens.
 *
 * A single total cannot answer "which step is expensive", which is the only
 * question worth asking of this table once it has a month of data in it.
 */
export type LlmPurpose = "concepts" | "traits" | "compliance" | "ask";

export interface LlmUsageRow {
  business_id: string;
  model: string;
  purpose: LlmPurpose;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd_micros: number;
}

/** Pure: the row for one call. Separated so it is testable without a database. */
export function usageRow(
  businessId: string,
  purpose: LlmPurpose,
  model: string,
  usage: ClaudeUsage,
): LlmUsageRow {
  return {
    business_id: businessId,
    model,
    purpose,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    cost_usd_micros: llmCostUsdMicros(model, usage),
  };
}

export interface UsageMeter {
  /** Pass as `onUsage` on a ClaudeCall. */
  sink: ClaudeUsageSink;
  /** Wait for the writes. Never rejects, however badly the writes went. */
  flush(): Promise<void>;
}

/**
 * A meter for one business and one step.
 *
 * Returns a sink to hand to `callClaude` and a `flush` to await before the
 * handler returns. Build one per business per step rather than one global
 * recorder: module-level state in a serverless function handling concurrent
 * requests is how one customer's cost ends up charged to another.
 */
export function usageMeter(
  supabase: SupabaseClient,
  businessId: string,
  purpose: LlmPurpose,
): UsageMeter {
  const pending: Promise<unknown>[] = [];

  const sink: ClaudeUsageSink = (model, usage) => {
    // Nothing was spent, so there is nothing to record. Skipping keeps the
    // table free of rows that only say "a call failed before it started".
    if (usage.inputTokens === 0 && usage.outputTokens === 0) return;
    pending.push(
      Promise.resolve(
        supabase.from("llm_usage").insert(usageRow(businessId, purpose, model, usage)),
      ).catch(() => undefined),
    );
  };

  return {
    sink,
    async flush() {
      // allSettled, not all: one rejected insert must not hide the others, and
      // flush itself must not throw into a caller that is finishing up.
      await Promise.allSettled(pending.splice(0, pending.length));
    },
  };
}

/** A meter that records nothing, for callers with no business in hand. */
export const NO_METER: UsageMeter = {
  sink: () => undefined,
  flush: async () => undefined,
};
