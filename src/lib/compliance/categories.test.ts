import { describe, expect, it } from "vitest";
import { screenCategory } from "./categories";

describe("screenCategory", () => {
  it("blocks prohibited verticals", () => {
    expect(screenCategory("Weapons & ammo")).toBe("blocked");
    expect(screenCategory("online GAMBLING site")).toBe("blocked");
    expect(screenCategory("forex signals group")).toBe("blocked");
  });

  it("flags restricted verticals for gateway scrutiny", () => {
    expect(screenCategory("Wine retailer")).toBe("restricted");
    expect(screenCategory("Spanish wines & spirits")).toBe("restricted");
    expect(screenCategory("weight loss coaching")).toBe("restricted");
  });

  it("allows ordinary businesses", () => {
    expect(screenCategory("Fashion boutique")).toBe("allowed");
    expect(screenCategory("Phone accessories shop")).toBe("allowed");
    expect(screenCategory("Restaurant")).toBe("allowed");
  });

  it("blocks empty input", () => {
    expect(screenCategory("   ")).toBe("blocked");
  });
});
