import { describe, expect, it } from "vitest";
import {
  asPlan,
  isPaid,
  launchGate,
  planAllowsLaunch,
  planAllowsRender,
  planSummary,
  rendersRemaining,
  renderGate,
  type PlanState,
} from "./plan";

const freeFresh: PlanState = { plan: "free", freeRenderUsed: false };
const freeUsed: PlanState = { plan: "free", freeRenderUsed: true };
const paid: PlanState = { plan: "paid", freeRenderUsed: true };

describe("asPlan", () => {
  it("free/null/empty is free; any other value (tiers or 'paid') is paid", () => {
    expect(asPlan("free")).toBe("free");
    expect(asPlan(null)).toBe("free");
    expect(asPlan("")).toBe("free");
    expect(asPlan("paid")).toBe("paid");
    expect(asPlan("starter")).toBe("paid");
    expect(asPlan("growth")).toBe("paid");
    expect(asPlan("scale")).toBe("paid");
  });
});

describe("renders", () => {
  it("free gets exactly one render, then none", () => {
    expect(rendersRemaining(freeFresh)).toBe(1);
    expect(planAllowsRender(freeFresh)).toBe(true);
    expect(rendersRemaining(freeUsed)).toBe(0);
    expect(planAllowsRender(freeUsed)).toBe(false);
  });
  it("paid is unlimited", () => {
    expect(rendersRemaining(paid)).toBe(Number.POSITIVE_INFINITY);
    expect(planAllowsRender(paid)).toBe(true);
    expect(isPaid(paid)).toBe(true);
  });
});

describe("launch", () => {
  it("only paid may launch ads", () => {
    expect(planAllowsLaunch(freeFresh)).toBe(false);
    expect(planAllowsLaunch(freeUsed)).toBe(false);
    expect(planAllowsLaunch(paid)).toBe(true);
  });
});

describe("gates", () => {
  it("render gate opens once, launch gate stays shut on free", () => {
    expect(renderGate(freeFresh)).toBe("ok");
    expect(renderGate(freeUsed)).toBe("needs_upgrade_render");
    expect(launchGate(freeFresh)).toBe("needs_upgrade_launch");
    expect(launchGate(paid)).toBe("ok");
  });
});

describe("planSummary", () => {
  it("reads differently across the three states", () => {
    expect(planSummary(freeFresh)).toMatch(/render one ad/i);
    expect(planSummary(freeUsed)).toMatch(/used your free preview/i);
    expect(planSummary(paid)).toMatch(/full plan/i);
  });
});
