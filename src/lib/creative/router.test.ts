import { describe, expect, it } from "vitest";
import { preferenceFor, routeRender } from "./router";
import type { RenderTier } from "@/lib/billing/plan";
import type { RenderEngine } from "./engine";

const engine = (name: "fal" | "higgsfield"): RenderEngine => ({ modelFor: () => "test/model",
  name,
  submit: async () => ({ state: "queued", jobId: "j" }) as never,
  poll: async () => ({ state: "queued", jobId: "j" }) as never,
});
const FAL = engine("fal");
const HF = engine("higgsfield");
const BOTH = [FAL, HF];
const TIERS: RenderTier[] = ["free", "starter", "growth", "scale"];

describe("the tier policy", () => {
  // The founder decision of 5 Nov 2026, case by case. If one of these changes,
  // it should be because the policy changed, not because something leaked.
  const expected: Record<RenderTier, { image: string; video: string }> = {
    free: { image: "fal", video: "fal" },
    starter: { image: "fal", video: "higgsfield" },
    growth: { image: "fal", video: "higgsfield" },
    scale: { image: "higgsfield", video: "higgsfield" },
  };

  for (const tier of TIERS) {
    for (const kind of ["image", "video"] as const) {
      it(`sends a ${tier} ${kind} to ${expected[tier][kind]}`, () => {
        const r = routeRender({ kind, tier, available: BOTH });
        expect(r.order[0].name).toBe(expected[tier][kind]);
        expect(r.degraded).toBe(false);
      });
    }
  }

  it("gives a free account no Higgsfield at all", () => {
    for (const kind of ["image", "video"] as const) {
      const r = routeRender({ kind, tier: "free", available: BOTH });
      expect(r.order.map((e) => e.name)).not.toContain("higgsfield");
    }
  });

  it("gives scale Higgsfield for images, which is the one tier that does", () => {
    const withHf = TIERS.filter(
      (t) => routeRender({ kind: "image", tier: t, available: BOTH }).order[0].name === "higgsfield",
    );
    expect(withHf).toEqual(["scale"]);
  });
});

describe("failover by tier", () => {
  it("gives a free account exactly one engine and no second attempt", () => {
    for (const kind of ["image", "video"] as const) {
      const r = routeRender({ kind, tier: "free", available: BOTH });
      expect(r.order).toHaveLength(1);
    }
  });

  it("caps a free account at one engine even when its own engine is missing", () => {
    // The cap is the restriction, not the vendor's name -- the mistake the old
    // version made was naming fal, so the limit evaporated when fal did.
    const r = routeRender({ kind: "image", tier: "free", available: [HF] });
    expect(r.order).toHaveLength(1);
    expect(r.order[0].name).toBe("higgsfield");
  });

  it("gives every paid tier the other engine as failover", () => {
    for (const tier of ["starter", "growth", "scale"] as const) {
      const r = routeRender({ kind: "video", tier, available: BOTH });
      expect(r.order).toHaveLength(2);
      expect(r.order[1].name).not.toBe(r.order[0].name);
    }
  });
});

describe("when the policy cannot be honoured", () => {
  it("still renders, and says the policy is not in force", () => {
    // Starter images are meant to go to fal. With no fal key there is nothing
    // to route to, so the render happens on Higgsfield and is flagged.
    const r = routeRender({ kind: "image", tier: "starter", available: [HF] });
    expect(r.order.map((e) => e.name)).toEqual(["higgsfield"]);
    expect(r.degraded).toBe(true);
    expect(r.reason).toMatch(/not in force/);
    expect(r.reason).toMatch(/fal is not configured/);
  });

  it("flags every tier whose engine is missing, not just some", () => {
    // With Higgsfield alone, the three fal-image rows are all inoperative.
    const degraded = TIERS.filter(
      (t) => routeRender({ kind: "image", tier: t, available: [HF] }).degraded,
    );
    expect(degraded).toEqual(["free", "starter", "growth"]);
  });

  it("does not flag a route that got what it asked for", () => {
    expect(routeRender({ kind: "image", tier: "scale", available: [HF] }).degraded).toBe(false);
    expect(routeRender({ kind: "image", tier: "free", available: [FAL] }).degraded).toBe(false);
  });

  it("never refuses to render when any engine exists", () => {
    for (const tier of TIERS) {
      for (const kind of ["image", "video"] as const) {
        for (const available of [BOTH, [FAL], [HF]]) {
          const r = routeRender({ kind, tier, available });
          expect(r.order.length).toBeGreaterThan(0);
          expect(r.reason.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it("returns nothing rather than throwing when no engine is configured", () => {
    for (const tier of TIERS) {
      const r = routeRender({ kind: "image", tier, available: [] });
      expect(r.order).toEqual([]);
      expect(r.reason).toMatch(/No render engine/);
      expect(r.degraded).toBe(true);
    }
  });
});

describe("the RENDER_PRIMARY override", () => {
  it("overrides the tier table for every tier and kind", () => {
    // The case it exists for: stop spending Higgsfield credits now.
    for (const tier of TIERS) {
      for (const kind of ["image", "video"] as const) {
        const r = routeRender({ kind, tier, available: BOTH, primary: "fal" });
        expect(r.order[0].name).toBe("fal");
      }
    }
  });

  it("can also force everything onto Higgsfield", () => {
    const r = routeRender({ kind: "image", tier: "free", available: BOTH, primary: "higgsfield" });
    expect(r.order[0].name).toBe("higgsfield");
  });

  it("still respects the free tier's no-failover cap", () => {
    const r = routeRender({ kind: "image", tier: "free", available: BOTH, primary: "higgsfield" });
    expect(r.order).toHaveLength(1);
  });

  it("names itself in the reason, so an override is never mistaken for policy", () => {
    const r = routeRender({ kind: "video", tier: "scale", available: BOTH, primary: "fal" });
    expect(r.reason).toMatch(/RENDER_PRIMARY/);
  });

  it("is absent by default, leaving the tier table in charge", () => {
    const r = routeRender({ kind: "image", tier: "scale", available: BOTH });
    expect(r.reason).not.toMatch(/RENDER_PRIMARY/);
    expect(r.order[0].name).toBe("higgsfield");
  });
});

describe("preferenceFor", () => {
  it("reads the table by tier and kind", () => {
    expect(preferenceFor("video", "starter")).toEqual(["higgsfield", "fal"]);
    expect(preferenceFor("image", "starter")).toEqual(["fal", "higgsfield"]);
    expect(preferenceFor("image", "scale")).toEqual(["higgsfield", "fal"]);
    expect(preferenceFor("video", "free")).toEqual(["fal"]);
  });

  it("lets an explicit primary override the table", () => {
    expect(preferenceFor("image", "scale", "fal")).toEqual(["fal", "higgsfield"]);
    expect(preferenceFor("video", "free", "higgsfield")).toEqual(["higgsfield"]);
  });
});
