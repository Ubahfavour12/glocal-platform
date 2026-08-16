import { describe, expect, it } from "vitest";
import {
  defaultGoalFor,
  goalOptionsFor,
  isImpossible,
  measurementFor,
} from "./measurability";
import type { Door, Goal } from "./inference";

const DOORS: Door[] = ["whatsapp", "link", "store"];
const GOALS: Goal[] = ["whatsapp", "sales", "leads", "visits"];

describe("measurementFor", () => {
  it("counts conversations only when the tap opens one", () => {
    expect(measurementFor("whatsapp", "whatsapp").measurement).toBe("auto");
    expect(measurementFor("whatsapp", "link").measurement).toBe("impossible");
    expect(measurementFor("whatsapp", "store").measurement).toBe("impossible");
  });

  it("reads real order value straight from a connected store", () => {
    const m = measurementFor("sales", "store");
    expect(m.measurement).toBe("auto");
    expect(m.note).toMatch(/nothing for you to do/i);
  });

  it("offers sales without a store, rather than refusing them", () => {
    // The whole point: a WhatsApp seller can still be judged on money, it
    // just costs them a tap a day to get there.
    for (const door of ["whatsapp", "link"] as Door[]) {
      const m = measurementFor("sales", door);
      expect(m.measurement, door).toBe("self_reported");
      expect(m.note, door).toMatch(/tap the one that brought the buyer/);
    }
  });

  it("quotes the real consistency gate, so the promise cannot drift", () => {
    // If the gate ever moves, this sentence moves with it.
    expect(measurementFor("sales", "whatsapp").note).toMatch(/3 sales across 2 days/);
  });

  it("never promises footfall automatically, through any door", () => {
    for (const door of DOORS) {
      const m = measurementFor("visits", door);
      expect(m.measurement, door).toBe("self_reported");
      expect(m.note, door).toMatch(/No ad platform/);
    }
  });

  it("treats leads as visible through every door", () => {
    for (const door of DOORS) {
      expect(measurementFor("leads", door).measurement, door).toBe("auto");
    }
  });

  it("always explains a closed option instead of just disabling it", () => {
    for (const door of DOORS) {
      for (const goal of GOALS) {
        const m = measurementFor(goal, door);
        if (m.measurement === "impossible") {
          expect(m.note, `${goal}/${door}`).toBeTruthy();
        }
      }
    }
  });
});

describe("goalOptionsFor", () => {
  it("puts what works first and what cannot work last", () => {
    const opts = goalOptionsFor("link");
    expect(opts[0].measurement).toBe("auto");
    expect(opts[opts.length - 1].measurement).toBe("impossible");
  });

  it("offers every goal for every door, closed ones included", () => {
    // Hiding an option makes the product look broken; closing it with a
    // reason teaches the owner how their own tracking works.
    for (const door of DOORS) {
      expect(goalOptionsFor(door)).toHaveLength(GOALS.length);
    }
  });

  it("leaves a store with nothing impossible except conversations", () => {
    const closed = goalOptionsFor("store").filter((o) => o.measurement === "impossible");
    expect(closed.map((o) => o.goal)).toEqual(["whatsapp"]);
  });
});

describe("defaultGoalFor", () => {
  it("defaults to the strongest signal the door gives for free", () => {
    expect(defaultGoalFor("store")).toBe("sales");
    expect(defaultGoalFor("whatsapp")).toBe("whatsapp");
    expect(defaultGoalFor("link")).toBe("leads");
  });

  it("never defaults to something that asks for daily work", () => {
    for (const door of DOORS) {
      expect(measurementFor(defaultGoalFor(door), door).measurement, door).toBe("auto");
    }
  });

  it("never defaults to something impossible", () => {
    for (const door of DOORS) {
      expect(isImpossible(defaultGoalFor(door), door), door).toBe(false);
    }
  });
});
