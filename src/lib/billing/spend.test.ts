import { describe, expect, it } from "vitest";
import { DEFAULT_MARKUP_BPS, markupBpsOrDefault } from "./spend";

describe("markupBpsOrDefault", () => {
  it("keeps a valid subscription markup", () => {
    expect(markupBpsOrDefault(1500)).toBe(1500); // starter
    expect(markupBpsOrDefault(1200)).toBe(1200); // growth
    expect(markupBpsOrDefault(1000)).toBe(1000); // scale
    expect(markupBpsOrDefault(0)).toBe(0);
  });

  it("falls back to the Starter rate when absent or invalid", () => {
    expect(markupBpsOrDefault(null)).toBe(DEFAULT_MARKUP_BPS);
    expect(markupBpsOrDefault(undefined)).toBe(DEFAULT_MARKUP_BPS);
    expect(markupBpsOrDefault(-1)).toBe(DEFAULT_MARKUP_BPS);
    expect(markupBpsOrDefault(3001)).toBe(DEFAULT_MARKUP_BPS); // above the DB cap
    expect(markupBpsOrDefault(Number.NaN)).toBe(DEFAULT_MARKUP_BPS);
  });
});
