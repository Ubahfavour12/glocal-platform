import { describe, expect, it } from "vitest";
import {
  actionForTier,
  classifyRejection,
  handleRejection,
  hardStrikesInWindow,
  isFrozen,
  STRIKE_LIMIT,
  type Strike,
} from "./rejection";

const now = new Date("2026-07-19T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("classifyRejection", () => {
  it("soft: technical/formatting reasons auto-fix", () => {
    expect(classifyRejection("Too much text overlay on image")).toBe("soft");
    expect(classifyRejection("Low resolution / blurry creative")).toBe("soft");
    expect(classifyRejection("Broken landing page URL")).toBe("soft");
    expect(actionForTier("soft")).toBe("auto_fix");
  });

  it("hard: policy/legal reasons quarantine", () => {
    expect(classifyRejection("Circumvention of systems")).toBe("hard");
    expect(classifyRejection("Misleading or deceptive claim")).toBe("hard");
    expect(classifyRejection("Prohibited medical health claim")).toBe("hard");
    expect(actionForTier("hard")).toBe("quarantine");
  });

  it("fails safe: unknown reasons are treated as hard", () => {
    expect(classifyRejection("some brand-new reason code we've never seen")).toBe("hard");
  });

  it("hard takes precedence when both could match", () => {
    // mentions image quality (soft) AND misleading (hard) -> hard wins
    expect(classifyRejection("misleading claim on a low-resolution image")).toBe("hard");
  });
});

describe("Trust Score window", () => {
  const strikes: Strike[] = [
    { at: daysAgo(2), tier: "hard" },
    { at: daysAgo(20), tier: "hard" },
    { at: daysAgo(40), tier: "hard" }, // outside 30d window
    { at: daysAgo(1), tier: "soft" }, // soft never counts
  ];

  it("counts only hard strikes within 30 days", () => {
    expect(hardStrikesInWindow(strikes, now)).toBe(2);
  });

  it("not frozen below the limit", () => {
    expect(isFrozen(strikes, now)).toBe(false);
  });

  it("frozen at the limit", () => {
    const three = [...strikes, { at: daysAgo(5), tier: "hard" as const }];
    expect(hardStrikesInWindow(three, now)).toBe(3);
    expect(isFrozen(three, now)).toBe(true);
  });
});

describe("handleRejection — end to end decision", () => {
  it("soft rejection: auto-fix, no strike added", () => {
    const o = handleRejection("Text overlay too large", [{ at: daysAgo(3), tier: "hard" }], now);
    expect(o.tier).toBe("soft");
    expect(o.action).toBe("auto_fix");
    expect(o.strikeCount).toBe(1); // unchanged by a soft rejection
    expect(o.frozen).toBe(false);
    expect(o.message).toMatch(/fixing a technical issue/i);
  });

  it("hard rejection adds a strike and counts it", () => {
    const o = handleRejection("Deceptive claim", [{ at: daysAgo(3), tier: "hard" }], now);
    expect(o.strikeCount).toBe(2);
    expect(o.action).toBe("quarantine");
    expect(o.frozen).toBe(false);
  });

  it("third hard strike in 30 days freezes publishing", () => {
    const prior: Strike[] = [
      { at: daysAgo(10), tier: "hard" },
      { at: daysAgo(5), tier: "hard" },
    ];
    const o = handleRejection("Prohibited content", prior, now);
    expect(o.strikeCount).toBe(STRIKE_LIMIT);
    expect(o.frozen).toBe(true);
    expect(o.message).toMatch(/frozen/i);
  });
});
