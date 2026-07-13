/**
 * Claude client — the agent's reasoning core (TRD: AI layer).
 * Thin fetch wrapper so we carry no SDK weight. Model is configurable per
 * call: cheap models for high-volume steps, stronger models for the ones
 * that matter. Costs are real per token, so callers keep prompts tight.
 */

const API = "https://api.anthropic.com/v1/messages";

export const MODELS = {
  cheap: "claude-haiku-4-5-20251001", // bulk/structured extraction
  smart: "claude-sonnet-5", // concept writing, compliance judgement
} as const;

export type ClaudeModel = (typeof MODELS)[keyof typeof MODELS] | string;

function apiKey(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("ANTHROPIC_API_KEY not configured");
  return k;
}

export interface ClaudeCall {
  model?: ClaudeModel;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  error?: { message: string };
}

/** Single-turn call returning the assistant's text. */
export async function callClaude(call: ClaudeCall): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: call.model ?? MODELS.smart,
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
