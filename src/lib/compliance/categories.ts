/**
 * Onboarding category screening — UF-1 branch "prohibited category detected"
 * and PRD F-01. This is the first, cheapest compliance gate: it runs before
 * any money or media enters the system. The AI Compliance Gateway (Slice B)
 * screens the actual creatives.
 */

export type CategoryScreen = "allowed" | "restricted" | "blocked";

/** Never serviceable through the platform's master accounts. */
const BLOCKED: readonly string[] = [
  "weapons",
  "tobacco",
  "vaping",
  "adult",
  "escort",
  "recreational drugs",
  "counterfeit",
  "payday loans",
  "crypto investment",
  "forex signals",
  "gambling",
  "betting",
  "mlm",
  "pyramid",
];

/**
 * Serviceable, but every network applies special rules (age gates, geo
 * limits). The Compliance Gateway treats these as high-scrutiny. Alcohol is
 * deliberately here — it's our dogfood stress test.
 */
const RESTRICTED: readonly string[] = [
  "alcohol",
  "wine",
  "spirits",
  "beer",
  "supplements",
  "weight loss",
  "skincare treatment",
  "financial services",
  "insurance",
  "real estate",
  "dating",
  "pharmacy",
];

export function screenCategory(raw: string): CategoryScreen {
  const c = raw.trim().toLowerCase();
  if (c.length === 0) return "blocked";
  if (BLOCKED.some((b) => c.includes(b))) return "blocked";
  if (RESTRICTED.some((r) => c.includes(r))) return "restricted";
  return "allowed";
}
