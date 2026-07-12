/**
 * AI Compliance Gateway — Blueprint §6.1, PRD F-05.
 * Mandatory hard gate before any creative reaches an ad network API.
 *
 * Two layers:
 *  1. RULES (this file, deterministic): banned claims, trigger phrases,
 *     restricted-category constraints. Instant, free, cannot be bypassed.
 *  2. LLM (llm.ts, activates with ANTHROPIC_API_KEY): multimodal policy
 *     scan against the platform knowledge base.
 *
 * A creative must pass BOTH layers. High risk = hard block, no override
 * (Blueprint: "the Launch button is disabled... No exceptions").
 */

import { screenCategory, type CategoryScreen } from "./categories";

export interface CreativeInput {
  /** Ad copy / primary text */
  copy: string;
  /** Video transcript or image alt narrative, when available */
  transcript?: string;
  /** Business category from onboarding */
  category: string;
  /** Destination kind for the smart link */
  destinationKind: "whatsapp" | "call" | "url";
}

export interface GatewayIssue {
  code: string;
  severity: "block" | "review";
  detail: string;
}

export interface GatewayResult {
  verdict: "pass" | "block";
  riskScore: number; // 0..100
  issues: GatewayIssue[];
  layer: "rules" | "rules+llm";
}

/**
 * Deterministic banned patterns — each maps to real ad-network policy areas
 * that automated reviewer bots flag instantly. Grows from every real-world
 * rejection (Blueprint §6.2 gateway hardening).
 */
const BLOCKED_PATTERNS: { code: string; re: RegExp; detail: string }[] = [
  {
    code: "income_claim",
    re: /(make|earn|profit)\s+(?:\$|₦|£|€)?\s?[\d,]+\s*(?:k|thousand|million)?\s*(?:a|per|\/|in a|in one)\s*(day|week|month|hour)/i,
    detail: "Specific income promises (e.g. 'make $10,000 in a week') violate every network's deceptive-claims policy",
  },
  {
    code: "guaranteed_results",
    re: /\b(guaranteed?|100%)\s+(results?|profits?|returns?|weight\s*loss|cure|growth)\b/i,
    detail: "Guaranteed-outcome language is flagged as deceptive",
  },
  {
    code: "medical_cure",
    re: /\b(cures?|heals?|eliminates?)\s+(acne|cancer|diabetes|pain|anxiety|depression|illness|disease)\b/i,
    detail: "Medical cure claims are prohibited health content",
  },
  {
    code: "before_after_body",
    re: /\b(lose|lost)\s+\d+\s*(kg|lbs|pounds|kilos)\b/i,
    detail: "Specific weight-loss amounts trigger personal-health policy",
  },
  {
    code: "personal_attribute",
    re: /\b(are you|do you)\s+(fat|overweight|broke|in debt|depressed|struggling with)\b/i,
    detail: "Ads may not imply knowledge of personal attributes (health, finances)",
  },
  {
    code: "get_rich_scheme",
    re: /\b(passive income|financial freedom|quit your job|be your own boss)\b.{0,40}\b(today|now|instantly|overnight|fast)\b/i,
    detail: "Get-rich-quick framing triggers misleading-business-practice review",
  },
  {
    code: "crypto_forex",
    re: /\b(crypto|bitcoin|forex|binary options?)\s+(signals?|investment|trading group|profits?)\b/i,
    detail: "Unlicensed financial products are prohibited",
  },
  {
    code: "urgency_scarcity_extreme",
    re: /\b(last chance|act now|expires? in \d+ (minutes?|hours?))\b.{0,60}\b(or (miss out|lose|regret))\b/i,
    detail: "Extreme false-urgency patterns are flagged as manipulative",
  },
];

/** Patterns that don't block alone but raise the risk score for LLM scrutiny. */
const REVIEW_PATTERNS: { code: string; re: RegExp; detail: string }[] = [
  {
    code: "superlative_claim",
    re: /\b(best|cheapest|#1|number one)\b.{0,30}\b(in (the )?(world|country|nigeria|africa|uk))\b/i,
    detail: "Unverifiable superlatives often draw manual review",
  },
  {
    code: "free_bait",
    re: /\bfree\b.{0,30}\b(iphone|cash|money|giveaway)\b/i,
    detail: "Free-valuables bait resembles engagement-bait/scam patterns",
  },
  {
    code: "excessive_caps",
    re: /[A-Z]{6,}/,
    detail: "Long all-caps runs violate formatting norms",
  },
];

/** Alcohol rules — the dogfood category (Blueprint: deliberate stress test). */
const ALCOHOL_MINIMUM_AGE_COUNTRIES_BLOCKED = ["NG"]; // example: strict-list markets need per-country config
const ALCOHOL_FORBIDDEN = [
  {
    code: "alcohol_health_claim",
    re: /\b(healthy|good for you|medicinal)\b/i,
    detail: "Alcohol ads may not imply health benefits",
  },
  {
    code: "alcohol_excess",
    re: /\b(get (drunk|wasted)|drink all (day|night))\b/i,
    detail: "Alcohol ads may not promote excessive consumption",
  },
];

export function runRulesLayer(input: CreativeInput): GatewayResult {
  const text = `${input.copy}\n${input.transcript ?? ""}`;
  const issues: GatewayIssue[] = [];
  const categoryScreen: CategoryScreen = screenCategory(input.category);

  if (categoryScreen === "blocked") {
    issues.push({
      code: "category_blocked",
      severity: "block",
      detail: `Category "${input.category}" cannot be advertised through the platform`,
    });
  }

  for (const p of BLOCKED_PATTERNS) {
    if (p.re.test(text)) issues.push({ code: p.code, severity: "block", detail: p.detail });
  }
  for (const p of REVIEW_PATTERNS) {
    if (p.re.test(text)) issues.push({ code: p.code, severity: "review", detail: p.detail });
  }

  if (categoryScreen === "restricted" && /\b(wine|alcohol|spirits|beer)\b/i.test(input.category)) {
    for (const p of ALCOHOL_FORBIDDEN) {
      if (p.re.test(text)) issues.push({ code: p.code, severity: "block", detail: p.detail });
    }
    issues.push({
      code: "alcohol_targeting_constraints",
      severity: "review",
      detail: `Alcohol requires age-gated delivery and is prohibited in some markets (${ALCOHOL_MINIMUM_AGE_COUNTRIES_BLOCKED.join(", ")}); orchestrator must apply age/geo constraints`,
    });
  }

  const blocks = issues.filter((i) => i.severity === "block").length;
  const reviews = issues.filter((i) => i.severity === "review").length;
  const riskScore = Math.min(100, blocks * 50 + reviews * 15);

  return {
    verdict: blocks > 0 ? "block" : "pass",
    riskScore,
    issues,
    layer: "rules",
  };
}

/**
 * Full gateway: rules layer, then (when configured) the LLM layer.
 * The LLM can only make the result STRICTER — a rules-layer block is final.
 */
export async function runGateway(
  input: CreativeInput,
  llmScan?: (input: CreativeInput) => Promise<GatewayResult>,
): Promise<GatewayResult> {
  const rules = runRulesLayer(input);
  if (rules.verdict === "block" || !llmScan) return rules;

  const llm = await llmScan(input);
  return {
    verdict: llm.verdict === "block" ? "block" : "pass",
    riskScore: Math.max(rules.riskScore, llm.riskScore),
    issues: [...rules.issues, ...llm.issues],
    layer: "rules+llm",
  };
}
