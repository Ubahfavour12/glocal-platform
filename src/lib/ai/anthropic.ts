/**
 * Claude client — the agent's reasoning core (TRD: AI layer).
 * Thin fetch wrapper so we carry no SDK weight. Model is configurable per
 * call: cheap models for high-volume steps, stronger models for the ones
 * that matter. Costs are real per token, so callers keep prompts tight.
 */

import { fetchWithTimeout, LONG_TIMEOUT_MS } from "@/lib/net/fetch";
import { EMPTY_USAGE, type ClaudeUsage } from "./cost";
const API = "https://api.anthropic.com/v1/messages";

export const MODELS = {
  // Haiku 5.5: $0.10/$0.50 per MTok against Haiku 4.5's $1/$5 -- the same
  // bulk structured extraction for a tenth of the price. Verified no call site
  // passes budget_tokens, which this model rejects (adaptive thinking only).
  cheap: "claude-haiku-5-5", // bulk/structured extraction
  smart: "claude-sonnet-5", // concept writing, compliance judgement
} as const;

export type ClaudeModel = (typeof MODELS)[keyof typeof MODELS] | string;

function apiKey(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("ANTHROPIC_API_KEY not configured");
  return k;
}

/**
 * Told what a call cost, after it succeeded.
 *
 * A sink rather than a return value because almost every caller wants the
 * text and nothing else, and changing `callClaude`'s return type would have
 * touched every call site to serve the one concern none of them have. The
 * client stays ignorant of what the sink does with the numbers — it reports,
 * `ai/usage.ts` records.
 *
 * It must not throw and must not be awaited: cost accounting does not get to
 * fail ad creation. `reportUsage` enforces both.
 */
export type ClaudeUsageSink = (model: string, usage: ClaudeUsage) => void;

export interface ClaudeCall {
  model?: ClaudeModel;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional: where to report what this call cost. See ClaudeUsageSink. */
  onUsage?: ClaudeUsageSink;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  error?: { message: string };
  /**
   * The block this wrapper used to discard. Four fields, all optional on the
   * wire: a model without prompt caching returns only the first two.
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Normalise the wire shape, treating every missing field as zero. */
function usageFrom(res: MessagesResponse): ClaudeUsage {
  const u = res.usage;
  if (!u) return EMPTY_USAGE;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

/** Report usage without letting the sink break the call that produced it. */
function reportUsage(call: ClaudeCall, model: string, usage: ClaudeUsage): void {
  if (!call.onUsage) return;
  try {
    call.onUsage(model, usage);
  } catch {
    // Swallowed on purpose. A broken cost recorder must never turn a
    // successful generation into a failed one; the worst case is one
    // unrecorded call, which the next one does not inherit.
  }
}

/** Single-turn call returning the assistant's text. */
export async function callClaude(call: ClaudeCall): Promise<string> {
  const model = call.model ?? MODELS.smart;
  const res = await fetchWithTimeout(API, {
    timeoutMs: LONG_TIMEOUT_MS,
    // Safe to repeat: a second attempt spends tokens but creates nothing. A
    // 529 "overloaded" is the common failure here and retrying is the
    // documented answer to it -- without this, one busy minute at Anthropic
    // costs a customer their whole night's concepts.
    retries: 2,
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: call.maxTokens ?? 1024,
      // temperature is only sent when explicitly requested; newer models
      // reject it, and the default sampling is what we want anyway.
      ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
      ...(call.system ? { system: call.system } : {}),
      messages: [{ role: "user", content: call.user }],
    }),
  });
  const data = (await res.json()) as MessagesResponse;
  if (data.error) throw new Error(`Claude API: ${data.error.message}`);
  // Reported before the empty-text check: an answer we could not parse still
  // consumed tokens, and a cost we refuse to record because the reply
  // disappointed us is a cost that shows up only on the invoice.
  reportUsage(call, model, usageFrom(data));
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude API: empty response");
  return text;
}

/**
 * Call Claude and parse a JSON object/array from the reply. Models sometimes
 * wrap JSON in prose or fences, so we extract the first balanced JSON blob.
 */
export async function callClaudeJson<T>(call: ClaudeCall): Promise<T> {
  const raw = await callClaude(call);
  return parseJsonFromText<T>(raw);
}

export function parseJsonFromText<T>(raw: string): T {
  // strip code fences if present
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  // find first { or [ and matching last } or ]
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model reply");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("unbalanced JSON in model reply");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
