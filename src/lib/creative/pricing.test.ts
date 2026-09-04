import { describe, expect, it } from "vitest";
import { monthlyRenderCostUsdMinor, renderCostUsdMinor } from "./pricing";

describe("renderCostUsdMinor", () => {
  it("prices a video far above an image, which is the whole argument", () => {
    expect(renderCostUsdMinor("fal", "video")).toBeGreaterThan(
      renderCostUsdMinor("fal", "image") * 5,
    );
  });

  it("falls back to the dearer engine for anything unrecognised", () => {
    // Under-recording cost silently flatters the margin, which is the one
    // direction this must never fail in.
    expect(renderCostUsdMinor("nonsense", "video")).toBeGreaterThan(0);
  });

  it("takes an env override, so a real invoice corrects it without a deploy", () => {
    process.env.RENDER_PRICE_FAL_VIDEO_USD_MINOR = "77";
    expect(renderCostUsdMinor("fal", "video")).toBe(77);
    delete process.env.RENDER_PRICE_FAL_VIDEO_USD_MINOR;
  });

  it("ignores an override that is not a usable number", () => {
    process.env.RENDER_PRICE_FAL_IMAGE_USD_MINOR = "not-a-number";
    expect(renderCostUsdMinor("fal", "image")).toBeGreaterThan(0);
    delete process.env.RENDER_PRICE_FAL_IMAGE_USD_MINOR;
  });
});

describe("monthlyRenderCostUsdMinor", () => {
  it("shows why unweighted video would eat a subscription", () => {
    // Two videos a day for a month, against a $39 Starter plan.
    const monthly = monthlyRenderCostUsdMinor("fal", "video", 2);
    expect(monthly).toBeGreaterThan(1500); // more than $15 of a $39 plan
  });

  it("returns nothing for a nonsensical daily count", () => {
    expect(monthlyRenderCostUsdMinor("fal", "image", 0)).toBe(0);
    expect(monthlyRenderCostUsdMinor("fal", "image", -3)).toBe(0);
  });
});
