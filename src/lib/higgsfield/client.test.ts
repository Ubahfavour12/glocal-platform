import { describe, expect, it } from "vitest";
import {
  aspectRatioFor,
  buildRenderRequest,
  parseRenderStatus,
  type RenderConceptInput,
} from "./client";

const base = (over: Partial<RenderConceptInput> = {}): RenderConceptInput => ({
  conceptId: "c1",
  prompt: "Golden-hour flatlay of the bracelet on linen, slow push-in",
  sourceImageUrl: "https://cdn.example.com/photo.jpg",
  kind: "video",
  placement: "reel",
  durationSeconds: 8,
  ...over,
});

describe("aspectRatioFor", () => {
  it("verticals for reels and stories, feed and square otherwise", () => {
    expect(aspectRatioFor("reel")).toBe("9:16");
    expect(aspectRatioFor("story")).toBe("9:16");
    expect(aspectRatioFor("feed")).toBe("4:5");
    expect(aspectRatioFor("square")).toBe("1:1");
  });
});

describe("buildRenderRequest", () => {
  it("maps a video concept into the job payload", () => {
    const req = buildRenderRequest(base());
    expect(req).toMatchObject({
      concept_id: "c1",
      image_url: "https://cdn.example.com/photo.jpg",
      output: "video",
      aspect_ratio: "9:16",
      duration_seconds: 8,
    });
    expect(req.prompt).toMatch(/bracelet/);
  });

  it("omits duration for image renders", () => {
    const req = buildRenderRequest(base({ kind: "image", placement: "square" }));
    expect(req.output).toBe("image");
    expect(req.aspect_ratio).toBe("1:1");
    expect(req.duration_seconds).toBeUndefined();
  });

  it("clamps video duration into the allowed range", () => {
    expect(buildRenderRequest(base({ durationSeconds: 2 })).duration_seconds).toBe(5);
    expect(buildRenderRequest(base({ durationSeconds: 90 })).duration_seconds).toBe(30);
  });

  it("rejects an empty prompt or a non-URL image", () => {
    expect(() => buildRenderRequest(base({ prompt: "   " }))).toThrow(/prompt/);
    expect(() => buildRenderRequest(base({ sourceImageUrl: "photo.jpg" }))).toThrow(/absolute URL/);
  });
});

describe("parseRenderStatus", () => {
  it("normalises a completed job and surfaces the asset url", () => {
    const s = parseRenderStatus({
      id: "job_9",
      status: "completed",
      result: { assets: [{ url: "https://cdn.example.com/out.mp4" }] },
    });
    expect(s).toEqual({ jobId: "job_9", state: "done", mediaUrl: "https://cdn.example.com/out.mp4" });
  });

  it("maps queued/processing synonyms", () => {
    expect(parseRenderStatus({ job_id: "j", status: "pending" }).state).toBe("queued");
    expect(parseRenderStatus({ job_id: "j", state: "in_progress" }).state).toBe("processing");
  });

  it("does not leak a media url until the job is done", () => {
    const s = parseRenderStatus({ id: "j", status: "processing", output_url: "https://x/y.mp4" });
    expect(s.state).toBe("processing");
    expect(s.mediaUrl).toBeUndefined();
  });

  it("captures the error on failure", () => {
    const s = parseRenderStatus({ id: "j", status: "failed", error: { message: "nsfw blocked" } });
    expect(s.state).toBe("failed");
    expect(s.error).toMatch(/nsfw/);
  });

  it("unknown status defaults to processing (keep polling, never crash)", () => {
    expect(parseRenderStatus({ id: "j", status: "who_knows" }).state).toBe("processing");
  });

  it("real Higgsfield shape: request_id + nsfw + video_url", () => {
    expect(parseRenderStatus({ request_id: "req_1", status: "in_progress" })).toMatchObject({
      jobId: "req_1",
      state: "processing",
    });
    const nsfw = parseRenderStatus({ request_id: "r", status: "nsfw" });
    expect(nsfw.state).toBe("failed");
    expect(nsfw.error).toMatch(/unsafe/i);
    const done = parseRenderStatus({ request_id: "r", status: "completed", video_url: "https://cdn/v.mp4" });
    expect(done).toMatchObject({ state: "done", mediaUrl: "https://cdn/v.mp4" });
  });
});
