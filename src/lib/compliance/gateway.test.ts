import { describe, expect, it } from "vitest";
import { runGateway, runRulesLayer, type CreativeInput } from "./gateway";

const creative = (copy: string, category = "fashion boutique"): CreativeInput => ({
  copy,
  category,
  destinationKind: "whatsapp",
});

/**
 * KNOWN-BAD fixture library — Dev Plan §4: "Gateway must catch 100% of
 * known-bad before any live submission." Every real-world rejection gets
 * added here (Blueprint §6.2 hardening loop). If any of these ever passes,
 * the build fails.
 */
const KNOWN_BAD: { name: string; input: CreativeInput; expectCode: string }[] = [
  {
    name: "income promise",
    input: creative("Make $10,000 in a week with our system!"),
    expectCode: "income_claim",
  },
  {
    name: "naira income promise",
    input: creative("You can earn ₦500,000 per month from home"),
    expectCode: "income_claim",
  },
  {
    name: "guaranteed results",
    input: creative("100% guaranteed results or your money back"),
    expectCode: "guaranteed_results",
  },
  {
    name: "medical cure",
    input: creative("This serum cures acne in 2 hours"),
    expectCode: "medical_cure",
  },
  {
    name: "weight loss amount",
    input: creative("She lost 15kg using this one trick"),
    expectCode: "before_after_body",
  },
  {
    name: "personal attribute",
    input: creative("Are you broke? We can fix that."),
    expectCode: "personal_attribute",
  },
  {
    name: "get rich quick",
    input: creative("Unlock passive income today with zero effort"),
    expectCode: "get_rich_scheme",
  },
  {
    name: "forex signals",
    input: creative("Join our forex signals group for daily profits"),
    expectCode: "crypto_forex",
  },
  {
    name: "blocked category",
    input: creative("Premium cigars delivered", "tobacco shop"),
    expectCode: "category_blocked",
  },
  {
    name: "alcohol health claim",
    input: creative("Our red wine is healthy for your heart", "wine retailer"),
    expectCode: "alcohol_health_claim",
  },
  {
    name: "alcohol excess",
    input: creative("Get drunk with the boys all night!", "beer brand"),
    expectCode: "alcohol_excess",
  },
  {
    name: "bad transcript, clean copy",
    input: {
      copy: "Try our program",
      transcript: "In this video I show how you earn $5,000 per week guaranteed",
      category: "coaching",
      destinationKind: "url",
    },
    expectCode: "income_claim",
  },
];

/** KNOWN-GOOD: ordinary honest ads that must never be blocked by rules. */
const KNOWN_GOOD: { name: string; input: CreativeInput }[] = [
  { name: "fashion", input: creative("New season styles just landed. Message us on WhatsApp to order.") },
  { name: "restaurant", input: creative("Fresh jollof, grilled to order. Visit us this weekend in Lekki.") },
  {
    name: "clean wine ad (dogfood)",
    input: creative("Estate-bottled Spanish reds, delivered in London. Explore the collection.", "wine retailer"),
  },
  { name: "phones", input: creative("UK-used iPhones with 6-month warranty. Chat with us for prices.", "phone shop") },
];

describe("rules layer — known-bad catch rate must be 100%", () => {
  for (const fixture of KNOWN_BAD) {
    it(`blocks: ${fixture.name}`, () => {
      const result = runRulesLayer(fixture.input);
      expect(result.verdict).toBe("block");
      expect(result.issues.map((i) => i.code)).toContain(fixture.expectCode);
      expect(result.riskScore).toBeGreaterThanOrEqual(50);
    });
  }
});

describe("rules layer — known-good must pass", () => {
  for (const fixture of KNOWN_GOOD) {
    it(`passes: ${fixture.name}`, () => {
      const result = runRulesLayer(fixture.input);
      expect(result.verdict).toBe("pass");
    });
  }

  it("restricted categories pass but carry review flags for the orchestrator", () => {
    const result = runRulesLayer(KNOWN_GOOD[2].input); // clean wine ad
    expect(result.verdict).toBe("pass");
    expect(result.issues.map((i) => i.code)).toContain("alcohol_targeting_constraints");
  });
});

describe("full gateway composition", () => {
  it("a rules-layer block is final — LLM never runs", async () => {
    let llmCalled = false;
    const result = await runGateway(KNOWN_BAD[0].input, async () => {
      llmCalled = true;
      return { verdict: "pass", riskScore: 0, issues: [], layer: "rules" };
    });
    expect(result.verdict).toBe("block");
    expect(llmCalled).toBe(false);
  });

  it("LLM can only make the result stricter", async () => {
    const result = await runGateway(KNOWN_GOOD[0].input, async () => ({
      verdict: "block",
      riskScore: 90,
      issues: [{ code: "llm_policy", severity: "block", detail: "implied unrealistic outcome" }],
      layer: "rules",
    }));
    expect(result.verdict).toBe("block");
    expect(result.riskScore).toBe(90);
    expect(result.layer).toBe("rules+llm");
  });

  it("without an LLM configured, rules alone decide", async () => {
    const result = await runGateway(KNOWN_GOOD[0].input);
    expect(result.verdict).toBe("pass");
    expect(result.layer).toBe("rules");
  });
});
