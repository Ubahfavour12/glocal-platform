import { describe, expect, it } from "vitest";
import { preferenceFor, routeRender } from "./router";
import type { RenderEngine } from "./engine";

const engine = (name: "fal" | "higgsfield"): RenderEngine => ({ modelFor: () => "test/model",
  name,
  submit: async () => ({ state: "queued", jobId: "j" }) as never,
  poll: async () => ({ state: "queued", jobId: "j" }) as never,
});
const FAL = engine("fal");
const HF = engine("higgsfield");
const BOTH = [FAL, HF];

describe("preferenceFor", () => {
  it("leads with the primary for both kinds on a paid account", () => {
    // Kind no longer splits the order: the engine being paid for does the work
    // and the other is failover, whatever is being made.
    expect(preferenceFor("video", "paid", "higgsfield")).toEqual(["higgsfield", "fal"]);
    expect(preferenceFor("image", "paid", "higgsfield")).toEqual(["higgsfield", "fal"]);
    expect(preferenceFor("image", "paid", "fal")).toEqual(["fal", "higgsfield"]);
  });

  it("gives a free account the primary alone, with no failover", () => {
    // A video costs 10-40x an image and an unpaid account has not paid for
    // either, so one unpaid render must not become two attempts at two vendors.
    expect(preferenceFor("image", "free", "higgsfield")).toEqual(["higgsfield"]);
    expect(preferenceFor("video", "free", "higgsfield")).toEqual(["higgsfield"]);
  });

  it("defaults to the configured primary when none is passed", () => {
    // Default is Higgsfield; proven here so a silent flip back shows up.
    expect(preferenceFor("image", "paid")[0]).toBe("higgsfield");
  });
});

describe("routeRender", () => {
  it("puts the primary first and keeps the other as failover", () => {
    for (const kind of ["image", "video"] as const) {
      const r = routeRender({ kind, plan: "paid", available: BOTH, primary: "higgsfield" });
      expect(r.order.map((e) => e.name)).toEqual(["higgsfield", "fal"]);
    }
  });

  it("sends the first render of an account to the primary, not the other engine", () => {
    // This is the case the old kind-split got wrong. The first render on every
    // account is an image, so an image rule was the rule for first contact --
    // and it pointed away from the engine being paid for.
    const r = routeRender({ kind: "image", plan: "paid", available: BOTH, primary: "higgsfield" });
    expect(r.order[0].name).toBe("higgsfield");
  });

  it("follows a flipped primary without any other change", () => {
    const r = routeRender({ kind: "video", plan: "paid", available: BOTH, primary: "fal" });
    expect(r.order.map((e) => e.name)).toEqual(["fal", "higgsfield"]);
  });

  it("gives a free account exactly one engine even when both are configured", () => {
    const r = routeRender({ kind: "video", plan: "free", available: BOTH, primary: "higgsfield" });
    expect(r.order.map((e) => e.name)).toEqual(["higgsfield"]);
    expect(r.reason).toMatch(/no failover/);
  });

  it("still renders when the primary is missing", () => {
    // A preference must never be the reason nothing gets made.
    const r = routeRender({ kind: "video", plan: "paid", available: [FAL], primary: "higgsfield" });
    expect(r.order.map((e) => e.name)).toEqual(["fal"]);
    expect(r.reason).toMatch(/not configured/);
  });

  it("still gives a free account its one render when the primary is missing", () => {
    // The old version returned nothing here, which was not true: the caller
    // falls back to the full engine list on an empty route, so the render went
    // ahead anyway on the engine the journal had just called off limits. The
    // route now says what actually happens, and still caps it at one engine.
    const r = routeRender({ kind: "image", plan: "free", available: [FAL], primary: "higgsfield" });
    expect(r.order.map((e) => e.name)).toEqual(["fal"]);
    expect(r.reason).toMatch(/not configured/);
  });

  it("explains itself in every case, for the journal", () => {
    for (const plan of ["free", "paid"] as const) {
      for (const kind of ["image", "video"] as const) {
        for (const available of [BOTH, [FAL], [HF]]) {
          const r = routeRender({ kind, plan, available, primary: "higgsfield" });
          expect(r.reason.length).toBeGreaterThan(10);
          expect(r.order.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("returns nothing rather than throwing when no engine is configured", () => {
    // The render lane stays dormant instead of taking the nightly run down.
    for (const plan of ["free", "paid"] as const) {
      const r = routeRender({ kind: "image", plan, available: [], primary: "higgsfield" });
      expect(r.order).toEqual([]);
      expect(r.reason).toMatch(/No render engine/);
    }
  });
});
