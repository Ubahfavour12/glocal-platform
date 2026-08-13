import { describe, expect, it, vi } from "vitest";
import { availableEngines, submitWithFailover, type RenderEngine } from "./engine";
import type { RenderStatus } from "@/lib/fal/client";

const input = {
  conceptId: "c1",
  prompt: "Bottle on dark wood",
  sourceImageUrl: "https://cdn.example.com/bottle.jpg",
  kind: "image" as const,
  placement: "reel" as const,
};

function engine(name: "fal" | "higgsfield", submit: () => Promise<RenderStatus>): RenderEngine {
  return { name, submit, poll: async () => ({ jobId: "j", state: "done" }) };
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
