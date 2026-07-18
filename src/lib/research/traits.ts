/**
 * Winner-trait extraction — locked decision 2026-07-13.
 * After each verdict, analyse WHY the winner won and feed those traits into
 * the next generation of challengers. This turns the daily loop from random
 * mutation into genuine evolution (one cheap Claude call per verdict).
 */

import { callClaudeJson, MODELS } from "@/lib/ai/anthropic";

export interface CreativeSummary {
  hook: string;
  copy: string;
  cta: string;
  /** windowed performance for context */
  ctr: number;
  costPerResultUsdMinor: number | null;
}

export interface WinnerTraits {
  hookStyle: string; // e.g. "question hook", "pattern interrupt", "social proof"
  angle: string; // emotional/rational angle that carried it
  pacingNotes: string;
  whyItWon: string; // one-paragraph analysis vs the losers
}

const SYSTEM = `You analyse ad A/B test results. Given the winning creative and the losers with their metrics, identify the transferable TRAITS that made the winner win (hook style, angle, pacing), not surface content. Output STRICT JSON only.`;

export async function extractWinnerTraits(
  winner: CreativeSummary,
  losers: CreativeSummary[],
): Promise<WinnerTraits> {
  const fmt = (c: CreativeSummary, label: string) =>
    `${label}: hook="${c.hook}" copy="${c.copy}" cta="${c.cta}" ctr=${(c.ctr * 100).toFixed(2)}%${
      c.costPerResultUsdMinor !== null ? ` costPerResult=$${(c.costPerResultUsdMinor / 100).toFixed(2)}` : ""
    }`;

  const user = `${fmt(winner, "WINNER")}
${losers.map((l, i) => fmt(l, `LOSER ${i + 1}`)).join("\n")}

Return STRICT JSON:
{"hookStyle":"...","angle":"...","pacingNotes":"...","whyItWon":"one short paragraph"}`;

  return callClaudeJson<WinnerTraits>({
    model: MODELS.smart,
    system: SYSTEM,
    user,
    maxTokens: 600,
  });
}

/**
 * Turn stored traits (+ optional fatigue directive) into guidance text for
 * the concept engine's prompt. Pure and unit-tested.
 */
export function buildTraitGuidance(
  traits: WinnerTraits | null,
  styleDirective: "none" | "style_refresh" = "none",
): string {
  const parts: string[] = [];
  if (traits) {
    parts.push(
      `PROVEN WINNING TRAITS from this account's own tests — lean into these: hook style: ${traits.hookStyle}; angle: ${traits.angle}; pacing: ${traits.pacingNotes}. (${traits.whyItWon})`,
    );
  }
  if (styleDirective === "style_refresh") {
    parts.push(
      "STYLE REFRESH REQUIRED: the current champion is fatiguing. New concepts must diverge visually and use a DIFFERENT hook archetype than the champion — keep only the proven angle, change everything else about the presentation.",
    );
  }
  return parts.join("\n");
}
