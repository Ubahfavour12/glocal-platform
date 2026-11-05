import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRIMARY,
  availableEngines,
  enginesForJob,
  orderedEngines,
  preferredPrimary,
  standbyFor,
  submitWithFailover,
  type RenderEngine,
} from "./engine";
import type { RenderStatus } from "@/lib/fal/client";

const input = {
  conceptId: "c1",
  prompt: "Bottle on dark wood",
  sourceImageUrl: "https://cdn.example.com/bottle.jpg",
  kind: "image" as const,
  placement: "reel" as const,
};

function engine(name: "fal" | "higgsfield", submit: () => Promise<RenderStatus>): RenderEngine {
  return { modelFor: () => "test/model",
  name, submit, poll: async () => ({ jobId: "j", state: "done" }) };
}

const ok = (): Promise<RenderStatus> => Promise.resolve({ jobId: "j1", state: "queued" });
const unreachable = () => Promise.reject(new Error("connect ECONNREFUSED"));

describe("availableEngines", () => {
  it("puts the primary first and drops anything unconfigured", () => {
    const fal = engine("fal", ok);
    const hf = engine("higgsfield", ok);
    expect(availableEngines(fal, hf).map((e) => e.name)).toEqual(["fal", "higgsfield"]);
    expect(availableEngines(fal, null).map((e) => e.name)).toEqual(["fal"]);
    expect(availableEngines(null, hf).map((e) => e.name)).toEqual(["higgsfield"]);
  });

  it("returns nothing when neither is configured, keeping the lane dormant", () => {
    expect(availableEngines(null, null)).toEqual([]);
  });
});

describe("preferredPrimary", () => {
  it("defaults to the engine the subscription is for", () => {
    expect(DEFAULT_PRIMARY).toBe("higgsfield");
    expect(preferredPrimary(undefined)).toBe("higgsfield");
    expect(preferredPrimary("")).toBe("higgsfield");
  });

  it("accepts either engine name, however it is cased or padded", () => {
    expect(preferredPrimary("fal")).toBe("fal");
    expect(preferredPrimary(" FAL ")).toBe("fal");
    expect(preferredPrimary("Higgsfield")).toBe("higgsfield");
  });

  it("falls back to the default on anything it does not recognise", () => {
    // A typo in config must not leave the product with no primary at all.
    for (const bad of ["fal.ai", "higgs", "openai", "true", "1"]) {
      expect(preferredPrimary(bad)).toBe("higgsfield");
    }
  });
});

describe("standbyFor", () => {
  it("names the other engine", () => {
    expect(standbyFor("higgsfield")).toBe("fal");
    expect(standbyFor("fal")).toBe("higgsfield");
  });
});

describe("orderedEngines", () => {
  const fal = engine("fal", ok);
  const hf = engine("higgsfield", ok);

  it("puts the primary first whichever argument it arrived in", () => {
    // The whole point: priority is no longer argument order, which is how fal
    // stayed primary silently after the decision to pay for Higgsfield.
    expect(orderedEngines(fal, hf, "higgsfield").map((e) => e.name)).toEqual([
      "higgsfield",
      "fal",
    ]);
    expect(orderedEngines(fal, hf, "fal").map((e) => e.name)).toEqual(["fal", "higgsfield"]);
  });

  it("drops anything unconfigured and never leaves a gap", () => {
    expect(orderedEngines(fal, null, "higgsfield").map((e) => e.name)).toEqual(["fal"]);
    expect(orderedEngines(null, hf, "fal").map((e) => e.name)).toEqual(["higgsfield"]);
    expect(orderedEngines(null, null, "higgsfield")).toEqual([]);
  });

  it("defaults to Higgsfield with no primary passed", () => {
    expect(orderedEngines(fal, hf)[0].name).toBe("higgsfield");
  });
});

describe("enginesForJob", () => {
  const fal = engine("fal", ok);
  const hf = engine("higgsfield", ok);

  it("lets the route decide, not the configured order", () => {
    const order = enginesForJob([fal, hf], { order: [hf] });
    expect(order.map((e) => e.name)).toEqual(["higgsfield"]);
  });

  it("falls back to the configured engines only when the route is empty", () => {
    const order = enginesForJob([fal, hf], { order: [] });
    expect(order.map((e) => e.name)).toEqual(["fal", "higgsfield"]);
  });

  it("returns a copy, so a caller cannot mutate the engine list", () => {
    const engines = [fal, hf];
    enginesForJob(engines, { order: [] }).pop();
    expect(engines).toHaveLength(2);
  });
});

describe("submitWithFailover", () => {
  it("uses the primary and never touches the standby when it works", async () => {
    const standbySubmit = vi.fn(ok);
    const res = await submitWithFailover(
      [engine("fal", ok), engine("higgsfield", standbySubmit)],
      input,
    );
    expect(res?.engine).toBe("fal");
    expect(res?.failed).toEqual([]);
    expect(standbySubmit).not.toHaveBeenCalled();
  });

  it("falls back when the primary is unreachable", async () => {
    const res = await submitWithFailover(
      [engine("fal", unreachable), engine("higgsfield", ok)],
      input,
    );
    expect(res?.engine).toBe("higgsfield");
    expect(res?.failed[0].engine).toBe("fal");
    expect(res?.failed[0].error).toMatch(/ECONNREFUSED/);
  });

  it("returns null when every engine is unreachable", async () => {
    const res = await submitWithFailover(
      [engine("fal", unreachable), engine("higgsfield", unreachable)],
      input,
    );
    expect(res).toBeNull();
  });

  it("does not fail over on a content rejection", async () => {
    // A returned "failed" status is a verdict about the content, not an outage.
    // A second vendor would reject it for the same reason, so retrying there
    // would just spend twice for the same answer.
    const rejected = (): Promise<RenderStatus> =>
      Promise.resolve({ jobId: "j1", state: "failed", error: "blocked as unsafe content" });
    const standbySubmit = vi.fn(ok);
    const res = await submitWithFailover(
      [engine("fal", rejected), engine("higgsfield", standbySubmit)],
      input,
    );
    expect(res?.engine).toBe("fal");
    expect(res?.status.state).toBe("failed");
    expect(standbySubmit).not.toHaveBeenCalled();
  });
});
