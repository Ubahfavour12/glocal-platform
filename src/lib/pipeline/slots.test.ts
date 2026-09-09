import { describe, expect, it } from "vitest";
import { nextPickSelection, slotSummary, slotsRemaining } from "./slots";

describe("nextPickSelection — fills, does not replace", () => {
  it("takes a free slot and keeps what is already there", () => {
    // The whole point of the change: picking a second concept must not throw
    // away the first.
    expect(nextPickSelection("b", ["a"], 2)).toEqual(["b", "a"]);
  });

  it("puts the newest pick first, so it survives if something must be cut", () => {
    expect(nextPickSelection("c", ["a", "b"], 2)).toEqual(["c", "a"]);
  });

  it("pushes out the oldest only once every slot is taken", () => {
    const full = nextPickSelection("c", ["a", "b"], 2);
    expect(full).toHaveLength(2);
    expect(full).toContain("c");
    expect(full).not.toContain("b"); // b was the oldest of the two
  });

  it("moves a re-picked concept to the front rather than duplicating it", () => {
    expect(nextPickSelection("a", ["a", "b"], 2)).toEqual(["a", "b"]);
    expect(nextPickSelection("b", ["a", "b"], 2)).toEqual(["b", "a"]);
  });

  it("works from an empty plan", () => {
    expect(nextPickSelection("a", [], 2)).toEqual(["a"]);
  });

  it("honours a single-slot test, which a small budget produces", () => {
    expect(nextPickSelection("b", ["a"], 1)).toEqual(["b"]);
  });

  it("never returns more than the slots available", () => {
    for (const slots of [1, 2, 3]) {
      expect(nextPickSelection("x", ["a", "b", "c", "d"], slots)).toHaveLength(slots);
    }
  });

  it("treats a nonsense slot count as at least one, rather than dropping the pick", () => {
    expect(nextPickSelection("a", ["b"], 0)).toEqual(["a"]);
    expect(nextPickSelection("a", ["b"], -5)).toEqual(["a"]);
  });

  it("ignores an empty concept id instead of writing a blank into the plan", () => {
    expect(nextPickSelection("", ["a"], 2)).toEqual(["a"]);
  });
});

describe("slotsRemaining", () => {
  it("counts what is left", () => {
    expect(slotsRemaining([], 2)).toBe(2);
    expect(slotsRemaining(["a"], 2)).toBe(1);
    expect(slotsRemaining(["a", "b"], 2)).toBe(0);
  });

  it("does not count a duplicate twice", () => {
    expect(slotsRemaining(["a", "a"], 2)).toBe(1);
  });

  it("never goes negative when a plan somehow exceeds its slots", () => {
    expect(slotsRemaining(["a", "b", "c"], 2)).toBe(0);
  });
});

describe("slotSummary — says what is actually true", () => {
  it("reports free slots", () => {
    expect(slotSummary([], 2)).toContain("0 of 2 slots taken");
    expect(slotSummary(["a"], 2)).toContain("1 of 2 slots taken");
  });

  it("warns that a further pick costs an earlier one, once full", () => {
    const msg = slotSummary(["a", "b"], 2);
    expect(msg).toContain("full");
    expect(msg).toMatch(/swaps out the oldest/);
  });

  it("says so plainly when the budget funds no test at all", () => {
    expect(slotSummary([], 0)).toMatch(/cannot fund/);
  });

  it("blames the empty wallet, not the budget, because that is what to act on", () => {
    // Four of five live accounts sat here: paused for no money, told nothing.
    const msg = slotSummary([], 0, true);
    expect(msg).toMatch(/wallet is empty/i);
    expect(msg).toMatch(/Add funds/i);
    expect(msg).not.toMatch(/budget cannot fund/);
  });

  it("puts the empty wallet ahead of any slot arithmetic", () => {
    // Even with slots and picks present, no money means nothing runs.
    expect(slotSummary(["a"], 2, true)).toMatch(/wallet is empty/i);
  });

  it("uses singular wording for a one-slot test", () => {
    expect(slotSummary([], 1)).toContain("1 slot");
  });
});
