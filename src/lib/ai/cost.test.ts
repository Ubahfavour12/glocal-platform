import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_USAGE,
  MICROS_PER_USD_MINOR,
  isPricedModel,
  llmCostUsdMicros,
  microsToUsdMinor,
  rateFor,
  type ClaudeUsage,
} from "./cost";

const usage = (over: Partial<ClaudeUsage> = {}): ClaudeUsage => ({
  ...EMPTY_USAGE,
  ...over,
});

const ENV_KEYS = [
  "LLM_PRICE_CLAUDE_HAIKU_5_5_INPUT_USD_PER_MTOK",
  "LLM_PRICE_CLAUDE_HAIKU_5_5_OUTPUT_USD_PER_MTOK",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("llmCostUsdMicros", () => {
  it("prices a Haiku call from the published rate", () => {
    // 1,000 input at $0.10/MTok = $0.0001 = 100 micros.
    // 500 output at $0.50/MTok = $0.00025 = 250 micros.
    expect(
      llmCostUsdMicros("claude-haiku-5-5", usage({ inputTokens: 1000, outputTokens: 500 })),
    ).toBe(350);
  });

  it("prices a Sonnet call twenty times dearer for the same tokens", () => {
    // The reason the model id is stored rather than the vendor: the two models
    // this product calls differ by 20x per input token.
    const same = usage({ inputTokens: 1000, outputTokens: 500 });
    expect(llmCostUsdMicros("claude-sonnet-5", same)).toBe(1000 * 2 + 500 * 10);
    expect(llmCostUsdMicros("claude-sonnet-5", same)).toBe(
      llmCostUsdMicros("claude-haiku-5-5", same) * 20,
    );
  });

  it("charges Haiku's long-prompt tier above 100k tokens", () => {
    // $0.10 -> $0.50 in, $0.50 -> $2.50 out. Ignoring the cliff would
    // understate a long-context call by 80%.
    const long = usage({ inputTokens: 200_000, outputTokens: 1000 });
    expect(llmCostUsdMicros("claude-haiku-5-5", long)).toBe(200_000 * 0.5 + 1000 * 2.5);
  });

  it("measures the long-prompt tier against cached tokens too", () => {
    // A 150k-token prompt served from cache is still a 150k-token prompt.
    const cached = usage({ inputTokens: 1000, cacheReadInputTokens: 150_000 });
    expect(rateFor("claude-haiku-5-5", cached).inputPerMTokUsd).toBe(0.5);
  });

  it("charges cache writes at a premium and cache reads at a fraction", () => {
    const write = usage({ cacheCreationInputTokens: 1000 });
    const read = usage({ cacheReadInputTokens: 1000 });
    const plain = usage({ inputTokens: 1000 });
    expect(llmCostUsdMicros("claude-sonnet-5", write)).toBeGreaterThan(
      llmCostUsdMicros("claude-sonnet-5", plain),
    );
    expect(llmCostUsdMicros("claude-sonnet-5", read)).toBeLessThan(
      llmCostUsdMicros("claude-sonnet-5", plain),
    );
  });

  it("charges an unknown model at the dearest known rate", () => {
    // Same bias as renderCostUsdMinor's fallback to the dearer engine. A
    // missing figure that flatters the margin is the failure that costs money.
    const one = usage({ inputTokens: 1000 });
    const dearest = Math.max(
      llmCostUsdMicros("claude-opus-5", one),
      llmCostUsdMicros("claude-sonnet-5", one),
      llmCostUsdMicros("claude-haiku-5-5", one),
    );
    expect(llmCostUsdMicros("claude-something-unreleased", one)).toBe(dearest);
    expect(isPricedModel("claude-something-unreleased")).toBe(false);
    expect(isPricedModel("claude-haiku-5-5")).toBe(true);
  });

  it("lets a real invoice override a configured rate without a deploy", () => {
    process.env.LLM_PRICE_CLAUDE_HAIKU_5_5_INPUT_USD_PER_MTOK = "0.2";
    expect(llmCostUsdMicros("claude-haiku-5-5", usage({ inputTokens: 1000 }))).toBe(200);
  });

  it("ignores a nonsense override rather than recording NaN", () => {
    // A bad env var must not poison a month's total with NaN, which would
    // blank the dashboard rather than warn anyone.
    process.env.LLM_PRICE_CLAUDE_HAIKU_5_5_INPUT_USD_PER_MTOK = "not-a-number";
    expect(llmCostUsdMicros("claude-haiku-5-5", usage({ inputTokens: 1000 }))).toBe(100);
  });

  it("treats a missing or absurd token count as zero", () => {
    expect(llmCostUsdMicros("claude-haiku-5-5", EMPTY_USAGE)).toBe(0);
    expect(
      llmCostUsdMicros("claude-haiku-5-5", usage({ inputTokens: Number.NaN })),
    ).toBe(0);
    expect(llmCostUsdMicros("claude-haiku-5-5", usage({ inputTokens: -5 }))).toBe(0);
  });
});

describe("microsToUsdMinor", () => {
  it("rounds up, because a small LLM bill is not a zero LLM bill", () => {
    // THE POINT OF THE WHOLE MICROS DETOUR. A month of Haiku calls coming to
    // 0.4 cents is not free; rounding it down puts the invisible cost line
    // back exactly where it started.
    expect(microsToUsdMinor(1)).toBe(1);
    expect(microsToUsdMinor(MICROS_PER_USD_MINOR)).toBe(1);
    expect(microsToUsdMinor(MICROS_PER_USD_MINOR + 1)).toBe(2);
  });

  it("is zero only when nothing was spent", () => {
    expect(microsToUsdMinor(0)).toBe(0);
    expect(microsToUsdMinor(-1)).toBe(0);
    expect(microsToUsdMinor(Number.NaN)).toBe(0);
  });

  it("converts a realistic month without losing it to rounding", () => {
    // 2,000 Haiku calls at 350 micros each = 700,000 micros = 70 cents.
    expect(microsToUsdMinor(2000 * 350)).toBe(70);
  });
});
