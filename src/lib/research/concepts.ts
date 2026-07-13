/**
 * Concept engine — Blueprint Research Engine, PRD F-03.
 * Takes the viral ads the scraper ranked and reverse-engineers them into
 * scripted ad CONCEPTS for the customer's product. This is the "50 concepts"
 * step: Claude-only cost (cents), no rendering. Higgsfield later renders only
 * the two entering each day's test.
 */

import { callClaudeJson, MODELS } from "@/lib/ai/anthropic";
import type { ViralVideo } from "./youtube";

export interface ProductBrief {
  businessName: string;
  category: string;
  goal: "sales" | "leads" | "whatsapp" | "visits";
  /** free-text the owner gave at onboarding */
  description?: string;
}

export interface AdConcept {
  rank: number;
  hook: string; // the first-3-seconds line
  storyboard: string[]; // shot-by-shot beats
  copyAngle: string; // the primary text / caption
  cta: string;
  sourcePattern: string; // what viral structure this borrows
}

const SYSTEM = `You are a direct-response ad strategist. You reverse-engineer viral ads and adapt their winning STRUCTURE (never their exact content) into fresh ad concepts for a specific product.

Rules:
- Adapt the pattern (hook type, pacing, emotional angle, CTA style), not the words.
- Never write deceptive or unrealistic claims (no "make X in Y days", no guaranteed results, no medical cures). These get accounts banned.
- Hooks must earn the first 3 seconds. CTAs must match the business goal.
- Output STRICT JSON only, no prose.`;

/**
 * Generate N ad concepts for the product, informed by the ranked viral ads.
 * Returns concepts ranked 1..N by predicted fit (best first).
 */
export async function generateConcepts(
  product: ProductBrief,
  viral: ViralVideo[],
  count = 10,
): Promise<AdConcept[]> {
  const patterns = viral.slice(0, 15).map((v, i) =>
    `${i + 1}. "${v.title}" (${v.channelTitle}, ${Math.round(v.viralityScore).toLocaleString()} views/day)`,
  );

  const user = `PRODUCT
Business: ${product.businessName}
Category: ${product.category}
Goal: ${goalText(product.goal)}
Notes: ${product.description ?? "n/a"}

TOP VIRAL ADS IN THIS SPACE (ranked by views/day):
${patterns.join("\n")}

TASK
Produce ${count} distinct ad concepts for this product, each adapting the structure of the viral ads above. Rank them 1..${count}, best first.

Return STRICT JSON array; each item:
{"rank":1,"hook":"...","storyboard":["shot 1","shot 2","shot 3"],"copyAngle":"...","cta":"...","sourcePattern":"which viral structure this borrows and why it fits"}`;

  const concepts = await callClaudeJson<AdConcept[]>({
    model: MODELS.smart,
    system: SYSTEM,
    user,
    maxTokens: 4096,
  });

  // normalise ranks 1..N in case the model drifts
  return concepts
    .slice(0, count)
    .map((c, i) => ({ ...c, rank: i + 1, storyboard: c.storyboard ?? [] }));
}

function goalText(goal: ProductBrief["goal"]): string {
  switch (goal) {
    case "sales":
      return "drive purchases";
    case "leads":
      return "collect enquiries/leads";
    case "whatsapp":
      return "get WhatsApp messages";
    case "visits":
      return "drive store visits";
  }
}
