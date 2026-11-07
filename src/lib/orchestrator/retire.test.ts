import { describe, expect, it } from "vitest";
import { adsToRetire } from "./launcher-live";

const ad = (platformAdId: string | null, status: string | null = "ACTIVE") => ({
  platformAdId,
  status,
});

describe("adsToRetire", () => {
  it("retires the ad that was running before this one", () => {
    // THE SPARK BUG. Without this, a rotation starts ad B while ad A keeps
    // spending: one budget funds two ads, and the two runs overlap in time,
    // so the sequential comparison is not sequential at all.
    expect(adsToRetire([ad("old"), ad("new")], ["new"])).toEqual(["old"]);
  });

  it("never retires an ad that was just launched", () => {
    // Retiring the incoming ad would leave the account with nothing running.
    expect(adsToRetire([ad("a"), ad("b")], ["a", "b"])).toEqual([]);
  });

  it("leaves already-paused ads alone, so a retry does not churn", () => {
    expect(adsToRetire([ad("old", "PAUSED"), ad("older", "paused")], ["new"])).toEqual([]);
  });

  it("is case-insensitive about the stored status", () => {
    expect(adsToRetire([ad("x", "Paused")], ["new"])).toEqual([]);
    expect(adsToRetire([ad("x", "active")], ["new"])).toEqual(["x"]);
  });

  it("skips rows with no platform id, which were never live", () => {
    expect(adsToRetire([ad(null), ad("real")], ["new"])).toEqual(["real"]);
  });

  it("retires several stale ads at once", () => {
    const out = adsToRetire([ad("a"), ad("b"), ad("c"), ad("keep")], ["keep"]);
    expect(out.sort()).toEqual(["a", "b", "c"]);
  });

  it("handles an empty account and an empty launch without throwing", () => {
    expect(adsToRetire([], ["new"])).toEqual([]);
    expect(adsToRetire([ad("a")], [])).toEqual(["a"]);
  });

  it("treats an unknown status as still running", () => {
    // Erring toward "it might be live" is the safe direction: the worst case
    // is a redundant pause call, which Meta treats as a no-op.
    expect(adsToRetire([ad("x", null)], ["new"])).toEqual(["x"]);
    expect(adsToRetire([ad("y", "")], ["new"])).toEqual(["y"]);
  });
});
