import { describe, expect, it } from "vitest";
import { buildTraitGuidance, type WinnerTraits } from "./traits";

const traits: WinnerTraits = {
  hookStyle: "question hook",
  angle: "scarcity + authenticity",
  pacingNotes: "fast first 2 seconds, slow reveal",
  whyItWon: "It earned attention immediately and matched the WhatsApp goal.",
};

describe("buildTraitGuidance", () => {
  it("returns empty guidance with no traits and no directive", () => {
    expect(buildTraitGuidance(null, "none")).toBe("");
  });

  it("encodes winning traits for the concept prompt", () => {
    const g = buildTraitGuidance(traits, "none");
    expect(g).toMatch(/question hook/);
    expect(g).toMatch(/scarcity/);
    expect(g).not.toMatch(/STYLE REFRESH/);
  });

  it("adds the style-refresh directive when fatigue triggers", () => {
    const g = buildTraitGuidance(traits, "style_refresh");
    expect(g).toMatch(/STYLE REFRESH REQUIRED/);
    expect(g).toMatch(/DIFFERENT hook archetype/);
    // keeps the proven angle, changes presentation
    expect(g).toMatch(/proven angle/);
  });

  it("style refresh works even without stored traits", () => {
    const g = buildTraitGuidance(null, "style_refresh");
    expect(g).toMatch(/STYLE REFRESH REQUIRED/);
  });
});
