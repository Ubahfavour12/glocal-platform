/**
 * Turn Strategy Studio answers into a compact context block the concept engine
 * feeds to Claude, plus completeness helpers for the UI. Pure + fixture-tested.
 *
 * The brief ACCUMULATES. Every time the owner answers a question the answer is
 * appended rather than replacing what came before, because how a business wants
 * to be perceived shifts over time and the older answers still carry signal.
 * The agent sees the newest answer first and the earlier ones as background, so
 * it keeps learning about a customer instead of only ever knowing the last
 * thing they typed.
 *
 * Storage is backward compatible: the original flat shape
 * `{ audience: "text" }` is read as a single-entry history.
 */

import { STUDIO_QUESTIONS, type StudioAnswers } from "./questions";

/** One answer, kept with when it was given. */
export interface StudioEntry {
  v: string | string[];
  at: string;
}

/** Newest-first history per question id. */
export type StudioProfile = Record<string, StudioEntry[]>;

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

/** How many earlier answers to carry as background before we stop. */
const MAX_HISTORY_IN_BRIEF = 3;
/** Hard cap on stored entries per question, so the JSON cannot grow forever. */
export const MAX_ENTRIES_PER_QUESTION = 12;

function answerToText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ").trim();
  return (value ?? "").trim();
}

function isEntryArray(v: unknown): v is StudioEntry[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && "v" in v[0];
}

/**
 * Read either storage shape into a newest-first history. Unknown or empty
 * values become an empty history rather than throwing, so a malformed row can
 * never break the nightly run.
 */
export function normaliseProfile(raw: unknown): StudioProfile {
  const out: StudioProfile = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isEntryArray(v)) {
      out[k] = v.filter((e) => answerToText(e.v));
    } else if (typeof v === "string" || Array.isArray(v)) {
      const text = answerToText(v as string | string[]);
      if (text) out[k] = [{ v: v as string | string[], at: "" }];
    }
  }
  return out;
}

/** Append a new answer to a question's history, newest first. */
export function appendAnswer(
  profile: StudioProfile,
  questionId: string,
  value: string | string[],
  at: string,
): StudioProfile {
  if (!answerToText(value)) return profile;
  const prior = profile[questionId] ?? [];
  return {
    ...profile,
    [questionId]: [{ v: value, at }, ...prior].slice(0, MAX_ENTRIES_PER_QUESTION),
  };
}

/** The most recent answer to a question, as display text. */
export function latestAnswer(profile: StudioProfile, questionId: string): string {
  const h = profile[questionId];
  return h?.length ? answerToText(h[0].v) : "";
}

/**
 * How many questions have at least one answer (for the "n/10" UI). Accepts
 * either storage shape so callers never have to normalise first.
 */
export function answeredCount(raw: unknown): number {
  const profile = normaliseProfile(raw);
  return STUDIO_QUESTIONS.reduce((n, q) => (latestAnswer(profile, q.id) ? n + 1 : n), 0);
}

export function isStudioStarted(raw: unknown): boolean {
  return answeredCount(raw) > 0;
}

/** Total answers given across every question, including superseded ones. */
export function totalAnswersGiven(raw: unknown): number {
  return Object.values(normaliseProfile(raw)).reduce((n, h) => n + h.length, 0);
}

/**
 * Build the strategy context the concept prompt uses. The newest answer leads;
 * earlier ones follow as background so the agent understands how the owner's
 * thinking has developed. Returns "" when nothing is filled, so the pipeline
 * degrades gracefully to the quick-start brief.
 */
export function buildStrategyContext(raw: unknown): string {
  const profile = normaliseProfile(raw);
  const lines: string[] = [];
  for (const q of STUDIO_QUESTIONS) {
    const history = profile[q.id];
    if (!history?.length) continue;
    const label = BRIEF_LABELS[q.id] ?? q.id;
    const newest = answerToText(history[0].v);
    if (!newest) continue;
    const earlier = history
      .slice(1, 1 + MAX_HISTORY_IN_BRIEF)
      .map((e) => answerToText(e.v))
      .filter(Boolean);
    lines.push(
      earlier.length > 0
        ? `${label}: ${newest} (earlier answers, still useful background: ${earlier.join(" | ")})`
        : `${label}: ${newest}`,
    );
  }
  if (lines.length === 0) return "";
  return `BUSINESS STRATEGY (from the owner's deep brief — weight these heavily, newest answer first):\n${lines.join("\n")}`;
}

/** Legacy shape accepted by the save route before normalising. */
export type { StudioAnswers };
