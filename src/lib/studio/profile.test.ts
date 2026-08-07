import { describe, expect, it } from "vitest";
import {
  answeredCount,
  appendAnswer,
  buildStrategyContext,
  isStudioStarted,
  latestAnswer,
  normaliseProfile,
  MAX_ENTRIES_PER_QUESTION,
} from "./profile";
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

describe("accumulating brief", () => {
  it("appends newest-first and keeps earlier answers", () => {
    let p = appendAnswer({}, "audience", "Busy mums", "2026-08-01");
    p = appendAnswer(p, "audience", "Gift buyers, 25-40", "2026-08-08");
    expect(p.audience.map((e) => e.v)).toEqual(["Gift buyers, 25-40", "Busy mums"]);
    expect(latestAnswer(p, "audience")).toBe("Gift buyers, 25-40");
  });

  it("ignores empty answers", () => {
    expect(appendAnswer({}, "audience", "   ", "x")).toEqual({});
    expect(appendAnswer({}, "tone", [], "x")).toEqual({});
  });

  it("caps stored history so the json cannot grow forever", () => {
    let p: ReturnType<typeof appendAnswer> = {};
    for (let i = 0; i < MAX_ENTRIES_PER_QUESTION + 5; i++) {
      p = appendAnswer(p, "audience", `answer ${i}`, "x");
    }
    expect(p.audience).toHaveLength(MAX_ENTRIES_PER_QUESTION);
    expect(latestAnswer(p, "audience")).toBe(`answer ${MAX_ENTRIES_PER_QUESTION + 4}`);
  });

  it("reads the old flat shape as a single-entry history", () => {
    const p = normaliseProfile({ audience: "Busy mums", tone: ["Warm", "Bold"] });
    expect(latestAnswer(p, "audience")).toBe("Busy mums");
    expect(latestAnswer(p, "tone")).toBe("Warm, Bold");
    expect(answeredCount({ audience: "Busy mums" })).toBe(1);
  });

  it("gives the agent the newest answer plus earlier ones as background", () => {
    let p = appendAnswer({}, "audience", "Busy mums", "a");
    p = appendAnswer(p, "audience", "Gift buyers", "b");
    const ctx = buildStrategyContext(p);
    expect(ctx).toContain("Ideal customer: Gift buyers");
    expect(ctx).toContain("Busy mums");
    expect(ctx).toContain("newest answer first");
  });

  it("stays empty when nothing has been answered", () => {
    expect(buildStrategyContext({})).toBe("");
    expect(buildStrategyContext(null)).toBe("");
  });
});
