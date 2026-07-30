import { describe, expect, it } from "vitest";
import { answeredCount, buildStrategyContext, isStudioStarted } from "./profile";
import type { StudioAnswers } from "./questions";

const partial: StudioAnswers = {
  audience: "First-time skincare buyers, 20-35",
  positioning: "premium",
  tone: ["premium", "trustworthy"],
};

describe("answeredCount", () => {
  it("counts only non-empty answers (arrays and strings)", () => {
    expect(answeredCount(partial)).toBe(3);
    expect(answeredCount({})).toBe(0);
    expect(answeredCount({ audience: "  ", tone: [] })).toBe(0);
  });
});

describe("isStudioStarted", () => {
  it("true once anything is filled", () => {
    expect(isStudioStarted(partial)).toBe(true);
    expect(isStudioStarted({})).toBe(false);
    expect(isStudioStarted(null)).toBe(false);
  });
});

describe("buildStrategyContext", () => {
  it("renders a labelled block, joining multi-selects", () => {
    const ctx = buildStrategyContext(partial);
    expect(ctx).toContain("BUSINESS STRATEGY");
    expect(ctx).toContain("Ideal customer: First-time skincare buyers, 20-35");
    expect(ctx).toContain("Price positioning: premium");
    expect(ctx).toContain("Brand tone: premium, trustworthy");
    // unanswered questions are omitted
    expect(ctx).not.toContain("Proof");
  });
  it("empty answers -> empty string (pipeline degrades gracefully)", () => {
    expect(buildStrategyContext({})).toBe("");
    expect(buildStrategyContext(null)).toBe("");
  });
});
