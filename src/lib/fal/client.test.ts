import { describe, expect, it } from "vitest";
import {
  aspectRatioFor,
  buildFalBody,
  falImageSize,
  mediaUrlFrom,
  modelFor,
  parseRenderStatus,
  type FalConfig,
} from "./client";

const cfg: FalConfig = {
  apiKey: "fal_sk_test",
  baseUrl: "https://queue.fal.run",
  imageModel: "fal-ai/flux/dev/image-to-image",
  videoModel: "fal-ai/kling-video/v2/standard/image-to-video",
};

const input = {
  conceptId: "c1",
  prompt: "  Bottle on dark wood, warm evening light  ",
  sourceImageUrl: "https://cdn.example.com/bottle.jpg",
  kind: "image" as const,
  placement: "reel" as const,
};

describe("placement mapping", () => {
  it("keeps reels and stories vertical, feed 4:5, square 1:1", () => {
    expect(aspectRatioFor("reel")).toBe("9:16");
    expect(aspectRatioFor("story")).toBe("9:16");
    expect(aspectRatioFor("feed")).toBe("4:5");
    expect(aspectRatioFor("square")).toBe("1:1");
  });

  it("translates ratios into fal's named sizes", () => {
    expect(falImageSize("9:16")).toBe("portrait_16_9");
    expect(falImageSize("4:5")).toBe("portrait_4_3");
    expect(falImageSize("1:1")).toBe("square_hd");
  });
});

describe("buildFalBody", () => {
  it("builds an image job from the product photo", () => {
    const body = buildFalBody(input);
    expect(body.prompt).toBe("Bottle on dark wood, warm evening light");
    expect(body.image_url).toBe("https://cdn.example.com/bottle.jpg");
    expect(body.image_size).toBe("portrait_16_9");
    expect(body.enable_safety_checker).toBe(true);
  });

  it("keeps strength low so the product stays recognisable", () => {
    // A high strength redraws the item and mangles labels, which makes the ad
    // useless to a real seller.
    expect(Number(buildFalBody(input).strength)).toBeLessThanOrEqual(0.7);
  });

  it("clamps video duration into the supported range", () => {
    const long = buildFalBody({ ...input, kind: "video", durationSeconds: 60 });
    expect(long.duration).toBe("10");
    const short = buildFalBody({ ...input, kind: "video", durationSeconds: 1 });
    expect(short.duration).toBe("5");
    const dflt = buildFalBody({ ...input, kind: "video" });
    expect(dflt.duration).toBe("5");
  });

  it("refuses empty prompts and non-absolute image urls", () => {
    expect(() => buildFalBody({ ...input, prompt: "   " })).toThrow();
    expect(() => buildFalBody({ ...input, sourceImageUrl: "/local.jpg" })).toThrow();
  });
});

describe("modelFor", () => {
  it("picks the video model only for video", () => {
    expect(modelFor(cfg, "image")).toBe("fal-ai/flux/dev/image-to-image");
    expect(modelFor(cfg, "video")).toBe("fal-ai/kling-video/v2/standard/image-to-video");
  });
});

describe("parseRenderStatus", () => {
  it("maps fal queue states", () => {
    expect(parseRenderStatus({ request_id: "r1", status: "IN_QUEUE" }).state).toBe("queued");
    expect(parseRenderStatus({ request_id: "r1", status: "IN_PROGRESS" }).state).toBe("processing");
    expect(parseRenderStatus({ request_id: "r1", status: "COMPLETED" }).state).toBe("done");
  });

  it("treats a bare result payload as done", () => {
    const s = parseRenderStatus({ images: [{ url: "https://cdn/out.png" }] }, "r1");
    expect(s.state).toBe("done");
    expect(s.mediaUrl).toBe("https://cdn/out.png");
    expect(s.jobId).toBe("r1");
  });

  it("never leaks a media url on a failed job", () => {
    const s = parseRenderStatus({ request_id: "r1", status: "failed", error: "nope" });
    expect(s.state).toBe("failed");
    expect(s.mediaUrl).toBeUndefined();
    expect(s.error).toBe("nope");
  });

  it("falls back to a generic error message", () => {
    expect(parseRenderStatus({ status: "failed" }).error).toBe("render failed");
  });

  it("degrades to processing on an unknown state", () => {
    expect(parseRenderStatus({ request_id: "r1", status: "wat" }).state).toBe("processing");
  });
});

describe("mediaUrlFrom", () => {
  it("reads every shape fal returns", () => {
    expect(mediaUrlFrom({ video: { url: "v" } })).toBe("v");
    expect(mediaUrlFrom({ image: { url: "i" } })).toBe("i");
    expect(mediaUrlFrom({ images: [{ url: "a" }] })).toBe("a");
    expect(mediaUrlFrom({ url: "u" })).toBe("u");
    expect(mediaUrlFrom({})).toBeUndefined();
  });
});
