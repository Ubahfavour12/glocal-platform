/**
 * Turn Strategy Studio answers into a compact context block the concept engine
 * feeds to Claude, plus completeness helpers for the UI. Pure + fixture-tested.
 */

import { STUDIO_QUESTIONS, type StudioAnswers } from "./questions";

/** Labels for how each answer reads in the agent's brief. */
const BRIEF_LABELS: Record<string, string> = {
  audience: "Ideal customer",
  problem: "Problem solved",
  difference: "What sets them apart",
  positioning: "Price positioning",
  tone: "Brand tone",
  hero_offer: "Hero offer to push",
  objection: "Main buying objection to overcome",
  proof: "Proof / social proof",
  avoid: "Never say (compliance)",
  inspiration: "Style inspiration",
};

function answerToText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ").trim();
  return (value ?? "").trim();
}

/** How many questions have a real answer (for the "n/10 complete" UI). */
export function answeredCount(answers: StudioAnswers): number {
  return STUDIO_QUESTIONS.reduce((n, q) => (answerToText(answers[q.id]) ? n + 1 : n), 0);
}

export function isStudioStarted(answers: StudioAnswers | null | undefined): boolean {
  return !!answers && answeredCount(answers) > 0;
}

/**
 * Build the strategy context the concept prompt uses. Returns "" when nothing
 * is filled, so the pipeline degrades gracefully to the quick-start brief.
 */
export function buildStrategyContext(answers: StudioAnswers | null | undefined): string {
  if (!answers) return "";
  const lines: string[] = [];
  for (const q of STUDIO_QUESTIONS) {
    const text = answerToText(answers[q.id]);
    if (text) lines.push(`${BRIEF_LABELS[q.id] ?? q.id}: ${text}`);
  }
  if (lines.length === 0) return "";
  return `BUSINESS STRATEGY (from the owner's deep brief — weight these heavily):\n${lines.join("\n")}`;
}
