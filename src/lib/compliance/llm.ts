/**
 * LLM layer of the Compliance Gateway — Blueprint §6.1.
 * Runs AFTER the deterministic rules layer (gateway.ts) and can only make the
 * result STRICTER. Catches nuanced policy risk the regexes miss: implied
 * claims, misleading framing, restricted-vertical subtleties.
 *
 * Plugs into runGateway as the optional llmScan argument.
 */

import { callClaudeJson, MODELS } from "@/lib/ai/anthropic";
import type { CreativeInput, GatewayResult } from "./gateway";

const SYSTEM = `You are an ad-policy compliance reviewer for Meta, TikTok and Google Ads. You judge whether an ad creative is likely to be REJECTED by these networks' automated and human review.

Focus on: unrealistic/deceptive claims, implied personal attributes (health, finances), before/after or guaranteed-outcome framing, restricted verticals (alcohol, health, finance) and their special rules, and misleading urgency.

Be strict but fair: ordinary honest ads for real products must PASS. Output STRICT JSON only.`;

interface LlmVerdict {
  verdict: "pass" | "block";
  riskScore: number; // 0..100
  issues: { code: string; detail: string }[];
}

export async function llmGatewayScan(input: CreativeInput): Promise<GatewayResult> {
  const user = `AD CREATIVE
Category: ${input.category}
Copy: ${input.copy}
${input.transcript ? `Video transcript: ${input.transcript}` : ""}
Destination: ${input.destinationKind}

Judge rejection risk. Return STRICT JSON:
{"verdict":"pass|block","riskScore":0-100,"issues":[{"code":"short_slug","detail":"one sentence"}]}
Block only when a network would very likely reject it.`;

  const v = await callClaudeJson<LlmVerdict>({
    model: MODELS.smart,
    system: SYSTEM,
    user,
    maxTokens: 1024,
  });

  return {
    verdict: v.verdict === "block" ? "block" : "pass",
    riskScore: clamp(v.riskScore),
    issues: (v.issues ?? []).map((i) => ({
      code: `llm_${i.code}`,
      severity: v.verdict === "block" ? "block" : "review",
      detail: i.detail,
    })),
    layer: "rules",
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
