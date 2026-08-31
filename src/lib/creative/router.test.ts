import { describe, expect, it } from "vitest";
import { preferenceFor, routeRender } from "./router";
import type { RenderEngine } from "./engine";

const engine = (name: "fal" | "higgsfield"): RenderEngine => ({
  name,
  submit: async () => ({ state: "queued", jobId: "j" }) as never,
  poll: async () => ({ state: "queued", jobId: "j" }) as never,
});
const FAL = engine("fal");
const HF = engine("higgsfield");
const BOTH = [FAL, HF];

describe("preferenceFor", () => {
  it("sends video to Higgsfield and images to fal on a paid account", () => {
    expect(preferenceFor("video", "paid")).toEqual(["higgsfield", "fal"]);
    expect(preferenceFor("image", "paid")).toEqual(["fal", "higgsfield"]);
  });

  it("keeps a free account on fal whatever it is rendering", () => {
    // Tier beats kind deliberately: a video costs 10-40x an image, and an
    // unpaid account has not paid for the expensive engine.
    expect(preferenceFor("image", "free")).toEqual(["fal"]);
    expect(preferenceFor("video", "free")).toEqual(["fal"]);
  });
});

describe("routeRender", () => {
  it("puts the preferred engine first and keeps the other as failover", () => {
    const v = routeRender({ kind: "video", plan: "paid", available: BOTH });
    expect(v.order.map((e) => e.name)).toEqual(["higgsfield", "fal"]);

    const i = routeRender({ kind: "image", plan: "paid", available: BOTH });
    expect(i.order.map((e) => e.name)).toEqual(["fal", "higgsfield"]);
  });

  it("never lets a free account reach the expensive engine", () => {
    // Even asked for video, even with Higgsfield configured and available.
    const r = routeRender({ kind: "video", plan: "free", available: BOTH });
    expect(r.order.map((e) => e.name)).toEqual(["fal"]);
  });

  it("still renders when the preferred engine is missing", () => {
    // A preference must never be the reason nothing gets made.
    const r = routeRender({ kind: "video", plan: "paid", available: [FAL] });
    expect(r.order.map((e) => e.name)).toEqual(["fal"]);
    expect(r.reason).toMatch(/not configured/);
  });

  it("explains itself in every case, for the journal", () => {
    for (const plan of ["free", "paid"] as const) {
      for (const kind of ["image", "video"] as const) {
        expect(routeRender({ kind, plan, available: BOTH }).reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("returns nothing rather than throwing when no engine is configured", () => {
    // The render lane stays dormant instead of taking the nightly run down.
    const r = routeRender({ kind: "image", plan: "paid", available: [] });
    expect(r.order).toEqual([]);
    expect(r.reason).toMatch(/No render engine/);
  });

  it("gives a free account nothing when fal alone is unconfigured", () => {
    const r = routeRender({ kind: "image", plan: "free", available: [HF] });
    expect(r.order).toEqual([]);
    expect(r.reason).toMatch(/nothing to render on/);
  });
});
