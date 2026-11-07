/**
 * What a Claude call costs us.
 *
 * Until now: nothing in this codebase measured LLM spend at all. `callClaude`
 * read the response's text and threw the `usage` block away, so every concept
 * batch, every trait extraction and every compliance judgement was free as far
 * as the system knew — and `admin/economics.ts` computed a customer's margin
 * as revenue minus render cost, with the LLM bill simply absent. An account
 * with no renders and heavy copy generation read as pure profit.
 *
 * WHY MICRO-DOLLARS AND NOT CENTS. A Haiku 5.5 call on a 2,000-token prompt
 * costs about $0.0003. Rounded to the nearest cent that is zero, and a month
 * of zeros is exactly how a team concludes the LLM is free. Minor units are
 * the right currency for a customer's wallet and the wrong one for a unit
 * cost three orders of magnitude smaller. So this module returns micros
 * (1e-6 USD) and the aggregation converts once, at the end, where the numbers
 * are large enough for cents to mean something.
 *
 * These are CONFIGURED RATES, like `creative/pricing.ts` — published list
 * prices, not invoices. Override any of them from the environment when a real
 * bill arrives, without shipping code:
 *
 *   LLM_PRICE_CLAUDE_HAIKU_5_5_INPUT_USD_PER_MTOK
 *   LLM_PRICE_CLAUDE_HAIKU_5_5_OUTPUT_USD_PER_MTOK
 *   LLM_PRICE_CLAUDE_SONNET_5_INPUT_USD_PER_MTOK   ... and so on
 */

/** The token counts the Messages API returns on every response. */
export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the prompt cache. Billed at a premium over input. */
  cacheCreationInputTokens: number;
  /** Tokens served from the prompt cache. Billed at a fraction of input. */
  cacheReadInputTokens: number;
}

export const EMPTY_USAGE: ClaudeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

interface Rate {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  /**
   * Some models price a long prompt differently. Haiku 5.5 is $0.10/$0.50 up
   * to a 100k-token prompt and $0.50/$2.50 beyond it — a 5x cliff that would
   * quietly understate the bill by 80% on a long context if ignored.
   */
  longPrompt?: { aboveTokens: number; inputPerMTokUsd: number; outputPerMTokUsd: number };
}

/**
 * Published per-MTok rates. The two the product actually calls today are
 * haiku-5-5 (bulk extraction) and sonnet-5 (concepts, compliance); the rest
 * are here so a model swap does not silently fall through to the fallback.
 */
const RATES: Record<string, Rate> = {
  "claude-haiku-5-5": {
    inputPerMTokUsd: 0.1,
    outputPerMTokUsd: 0.5,
    longPrompt: { aboveTokens: 100_000, inputPerMTokUsd: 0.5, outputPerMTokUsd: 2.5 },
  },
  "claude-haiku-4-5": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  "claude-sonnet-5": { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  "claude-sonnet-5-5": { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  "claude-opus-5-5": { inputPerMTokUsd: 4, outputPerMTokUsd: 20 },
  "claude-opus-5": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
};

/**
 * Cache multipliers, relative to the model's input rate.
 *
 * A cache write costs about 1.25x a plain input token; a cache read about
 * 0.1x. Expressing them as multipliers rather than per-model prices means a
 * repriced model needs one edit, not three.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * The rate charged when the model is not in the table.
 *
 * The DEAREST known rate, deliberately, and for the same reason
 * `renderCostUsdMinor` falls back to the dearer engine: a missing figure that
 * flatters the margin is the failure that costs money. Overstating a cost
 * prompts someone to look; understating it prompts nobody.
 */
const FALLBACK_RATE: Rate = { inputPerMTokUsd: 5, outputPerMTokUsd: 25 };

/** Env key for a model's rate, e.g. claude-haiku-5-5 -> CLAUDE_HAIKU_5_5. */
function envKey(model: string, side: "INPUT" | "OUTPUT"): string {
  const slug = model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `LLM_PRICE_${slug}_${side}_USD_PER_MTOK`;
}

function envRate(model: string, side: "INPUT" | "OUTPUT"): number | null {
  const raw = process.env[envKey(model, side)];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Total prompt tokens, which is what a long-prompt tier is measured against. */
function promptTokens(u: ClaudeUsage): number {
  return u.inputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/** The effective rate for this call: table, long-prompt tier, then env override. */
export function rateFor(model: string, usage: ClaudeUsage = EMPTY_USAGE): Rate {
  const base = RATES[model] ?? FALLBACK_RATE;
  const tiered =
    base.longPrompt && promptTokens(usage) > base.longPrompt.aboveTokens
      ? base.longPrompt
      : base;
  return {
    inputPerMTokUsd: envRate(model, "INPUT") ?? tiered.inputPerMTokUsd,
    outputPerMTokUsd: envRate(model, "OUTPUT") ?? tiered.outputPerMTokUsd,
  };
}

/** True when this model has a published rate rather than the fallback. */
export function isPricedModel(model: string): boolean {
  return model in RATES;
}

/**
 * What one call cost, in micro-dollars (1e-6 USD).
 *
 * Never negative and never NaN: a usage block with a missing field is treated
 * as zero for that field rather than poisoning a month's total with NaN, which
 * would silently blank the admin dashboard.
 */
export function llmCostUsdMicros(model: string, usage: ClaudeUsage): number {
  const rate = rateFor(model, usage);
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  // (tokens / 1e6) * usd_per_mtok * 1e6 micros_per_usd == tokens * usd_per_mtok.
  // The two factors of a million cancel, which is why there is no 1e6 here.
  const micros =
    n(usage.inputTokens) * rate.inputPerMTokUsd +
    n(usage.outputTokens) * rate.outputPerMTokUsd +
    n(usage.cacheCreationInputTokens) * rate.inputPerMTokUsd * CACHE_WRITE_MULTIPLIER +
    n(usage.cacheReadInputTokens) * rate.inputPerMTokUsd * CACHE_READ_MULTIPLIER;
  return Math.round(micros);
}

/** 1 cent = 10,000 micro-dollars. */
export const MICROS_PER_USD_MINOR = 10_000;

/**
 * Micros to USD minor units, for the point where LLM cost meets money.
 *
 * Rounds UP. A month of LLM calls that comes to 0.4 cents is not free, and
 * rounding it to zero would put the only cost line nobody can see back where
 * it started.
 */
export function microsToUsdMinor(micros: number): number {
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return Math.ceil(micros / MICROS_PER_USD_MINOR);
}
