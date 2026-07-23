import { describe, expect, it } from "vitest";
import {
  canRenderToday,
  promptFromConcept,
  renderConcepts,
  type JobStatus,
  type RenderDeps,
  type RenderOptions,
} from "./render";

const concept = (id: string) => ({ conceptId: id, prompt: `visual for ${id}` });

const opts = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  sourceImageUrl: "https://cdn.example.com/photo.jpg",
  kind: "video",
  placement: "reel",
  quota: { usedToday: 0, dailyLimit: 2 },
  pollIntervalMs: 0,
  ...over,
});

function makeDeps(over: Partial<RenderDeps> = {}) {
  const persisted: { conceptId: string; mediaUrl: string }[] = [];
  const audits: unknown[] = [];
  let seq = 0;
  const deps: RenderDeps = {
    submit: async () => ({ jobId: `job_${seq++}` }),
    poll: async () => ({ state: "done", mediaUrl: "https://cdn/out.mp4" }) as JobStatus,
    sleep: async () => {},
    persist: async (conceptId, mediaUrl) => {
      persisted.push({ conceptId, mediaUrl });
    },
    audit: async (_a, d) => {
      audits.push(d);
    },
    ...over,
  };
  return { deps, persisted, audits };
}

describe("renderConcepts", () => {
  it("renders within quota and persists each finished creative", async () => {
    const { deps, persisted } = makeDeps();
    const s = await renderConcepts([concept("a"), concept("b")], opts(), deps);
    expect(s.rendered).toHaveLength(2);
    expect(s.skippedForQuota).toBe(0);
    expect(persisted.map((p) => p.conceptId)).toEqual(["a", "b"]);
  });

  it("skips concepts beyond the daily quota", async () => {
    const { deps } = makeDeps();
    const s = await renderConcepts(
      [concept("a"), concept("b"), concept("c")],
      opts({ quota: { usedToday: 1, dailyLimit: 2 } }), // only 1 render left
      deps,
    );
    expect(s.rendered).toHaveLength(1);
    expect(s.skippedForQuota).toBe(2);
  });

  it("polls until the job is done, then persists", async () => {
    let calls = 0;
    const { deps, persisted } = makeDeps({
      poll: async () => {
        calls += 1;
        return calls < 3
          ? ({ state: "processing" } as JobStatus)
          : ({ state: "done", mediaUrl: "https://cdn/x.mp4" } as JobStatus);
      },
    });
    const s = await renderConcepts([concept("a")], opts(), deps);
    expect(calls).toBe(3);
    expect(s.rendered).toHaveLength(1);
    expect(persisted).toHaveLength(1);
  });

  it("records a failed render without blocking the rest", async () => {
    let n = 0;
    const { deps } = makeDeps({
      poll: async () => {
        n += 1;
        return n === 1
          ? ({ state: "failed", error: "nsfw blocked" } as JobStatus)
          : ({ state: "done", mediaUrl: "https://cdn/ok.mp4" } as JobStatus);
      },
    });
    const s = await renderConcepts([concept("bad"), concept("good")], opts(), deps);
    expect(s.rendered.map((r) => r.conceptId)).toEqual(["good"]);
    expect(s.failed[0]).toMatchObject({ conceptId: "bad", error: "nsfw blocked" });
  });

  it("treats a job that never finishes as a timeout", async () => {
    const { deps } = makeDeps({
      poll: async () => ({ state: "processing" }) as JobStatus,
    });
    const s = await renderConcepts([concept("a")], opts({ maxPolls: 3 }), deps);
    expect(s.rendered).toHaveLength(0);
    expect(s.failed[0].error).toMatch(/timed out/);
  });

  it("a submit throw is captured as a failure, not a crash", async () => {
    const { deps } = makeDeps({
      submit: async () => {
        throw new Error("higgsfield 500");
      },
    });
    const s = await renderConcepts([concept("a")], opts(), deps);
    expect(s.failed[0].error).toMatch(/higgsfield 500/);
  });
});

describe("canRenderToday", () => {
  it("needs both quota and a real source image", () => {
    const q = { usedToday: 0, dailyLimit: 2 };
    expect(canRenderToday(q, "https://cdn/p.jpg")).toBe(true);
    expect(canRenderToday(q, null)).toBe(false);
    expect(canRenderToday(q, "not-a-url")).toBe(false);
    expect(canRenderToday({ usedToday: 2, dailyLimit: 2 }, "https://cdn/p.jpg")).toBe(false);
  });
});

describe("promptFromConcept", () => {
  it("joins hook and storyboard beats", () => {
    expect(promptFromConcept("Own the room", ["wide shot", "close up"])).toBe(
      "Own the room. wide shot; close up",
    );
    expect(promptFromConcept("Just the hook", [])).toBe("Just the hook");
  });
});
