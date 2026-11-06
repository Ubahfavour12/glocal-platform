import { describe, expect, it, vi } from "vitest";
import {
  aspectRatioFor,
  buildRenderRequest,
  parseRenderStatus,
  type RenderConceptInput,
  describeFailure,
  pathFromEnv,
  pollPathFor,
  resolveCredentials,
  higgsfieldConfigProblem,
  higgsfieldConfigFromEnv,
  toHiggsfieldBody,
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

describe("pathFromEnv", () => {
  it("falls back to the compiled-in default when unset or blank", () => {
    expect(pathFromEnv("video", {})).toBe("/v1/image2video/dop");
    expect(pathFromEnv("video", { HIGGSFIELD_VIDEO_PATH: "   " })).toBe("/v1/image2video/dop");
  });

  it("takes an override so a wrong slug is fixed without a deploy", () => {
    expect(pathFromEnv("image", { HIGGSFIELD_IMAGE_PATH: "/v1/flux_3_image" })).toBe(
      "/v1/flux_3_image",
    );
    expect(pathFromEnv("video", { HIGGSFIELD_VIDEO_PATH: " /v1/other " })).toBe("/v1/other");
  });

  it("ignores a value that is not a path, rather than building a nonsense URL", () => {
    // A full URL or bare host here would be concatenated onto the base.
    for (const bad of ["https://api.higgsfield.ai/v1/x", "api.higgsfield.ai", "v1/x"]) {
      expect(pathFromEnv("image", { HIGGSFIELD_IMAGE_PATH: bad })).toBe(
        "/higgsfield-ai/soul/v2/image-to-image",
      );
    }
  });
});

describe("pollPathFor", () => {
  it("substitutes the job id", () => {
    expect(pollPathFor("abc123", {})).toBe("/requests/abc123/status");
  });

  it("encodes a job id so it cannot escape its path segment", () => {
    expect(pollPathFor("a/b?c", {})).toBe("/requests/a%2Fb%3Fc/status");
  });

  it("appends the id when an override has no placeholder", () => {
    expect(pollPathFor("j1", { HIGGSFIELD_POLL_PATH: "/v1/requests" })).toBe("/v1/requests/j1");
    expect(pollPathFor("j1", { HIGGSFIELD_POLL_PATH: "/v1/requests/" })).toBe("/v1/requests/j1");
  });
});

describe("describeFailure", () => {
  it("names the status and the path, because the path is the suspect", () => {
    const msg = describeFailure("submit", 404, "/v1/flux-pro/kontext/max/image-to-image", "");
    expect(msg).toContain("404");
    expect(msg).toContain("/v1/flux-pro/kontext/max/image-to-image");
    expect(msg).toContain("HIGGSFIELD_IMAGE_PATH");
  });

  it("survives an HTML error page instead of losing the status code", () => {
    // The old code called res.json() first, so this case reached the journal
    // as "Unexpected token '<'" with no status, no path and no vendor message.
    const msg = describeFailure("submit", 404, "/v1/wrong", "<html><body>Not Found</body></html>");
    expect(msg).toContain("404");
    expect(msg).toContain("/v1/wrong");
  });

  it("reads the vendor's own message out of a JSON body", () => {
    const msg = describeFailure("poll", 400, "/requests/j/status", '{"message":"bad request id"}');
    expect(msg).toContain("bad request id");
  });

  it("tells auth and credit failures apart from a wrong path", () => {
    expect(describeFailure("submit", 401, "/p", "")).toContain("HIGGSFIELD_API_KEY");
    expect(describeFailure("submit", 402, "/p", "")).toContain("credits");
    expect(describeFailure("submit", 429, "/p", "")).toContain("rate limited");
    expect(describeFailure("submit", 500, "/p", "")).not.toContain("path is wrong");
  });

  it("calls a credits failure billing, not a bad key", () => {
    // The real first render returned `403 not_enough_credits`. An earlier
    // version answered that with "check your credentials", which sends the
    // reader off to re-paste a key that was never the problem.
    const msg = describeFailure("submit", 403, "/p", '{"detail":"not_enough_credits"}');
    expect(msg).toContain("billing, not the key");
    expect(msg).not.toMatch(/check HIGGSFIELD_API_KEY/);
  });

  it("still blames the key on a 401, where that is the actual cause", () => {
    expect(describeFailure("submit", 401, "/p", '{"detail":"invalid key"}')).toContain(
      "HIGGSFIELD_API_KEY",
    );
  });

  it("reads credits from the wording even on an unexpected status", () => {
    for (const body of ['{"detail":"insufficient balance"}', '{"detail":"quota exceeded"}']) {
      expect(describeFailure("submit", 500, "/p", body)).toContain("billing");
    }
  });

  it("explains a 403 with no useful body as refused rather than unauthenticated", () => {
    const msg = describeFailure("submit", 403, "/p", "");
    expect(msg).toMatch(/authenticated but refused/);
  });

  it("caps the body so an error page cannot flood the journal", () => {
    const msg = describeFailure("submit", 500, "/p", "x".repeat(5000));
    expect(msg.length).toBeLessThan(500);
  });

  it("never repeats the credentials", () => {
    // This text lands in logs and sometimes in the journal.
    const msg = describeFailure("submit", 403, "/p", '{"message":"key kid:secret rejected"}');
    expect(msg).toContain("403");
    expect(msg).not.toContain("HIGGSFIELD_CREDENTIALS=");
  });
});

describe("resolveCredentials", () => {
  it("accepts a lone key with no colon", () => {
    // THE REGRESSION. Higgsfield issued this account a single key; the old code
    // demanded a pair, resolved to "", threw, and the engine builder turned
    // that into "Higgsfield is not installed". A correct key did nothing and
    // said nothing.
    expect(resolveCredentials({ HIGGSFIELD_API_KEY: "hf_abc123" })).toEqual({
      credentials: "hf_abc123",
      shape: "single",
    });
  });

  it("joins a key and secret into a pair", () => {
    expect(
      resolveCredentials({ HIGGSFIELD_API_KEY: "kid", HIGGSFIELD_API_SECRET: "sec" }),
    ).toEqual({ credentials: "kid:sec", shape: "pair" });
  });

  it("takes a whole pair pasted into the key field", () => {
    expect(resolveCredentials({ HIGGSFIELD_API_KEY: "kid:sec" })).toEqual({
      credentials: "kid:sec",
      shape: "combined",
    });
  });

  it("lets HIGGSFIELD_CREDENTIALS win over everything else", () => {
    const r = resolveCredentials({
      HIGGSFIELD_CREDENTIALS: "explicit:wins",
      HIGGSFIELD_API_KEY: "kid",
      HIGGSFIELD_API_SECRET: "sec",
    });
    expect(r?.credentials).toBe("explicit:wins");
  });

  it("prefers the pair over a lone key when both are available", () => {
    const r = resolveCredentials({ HIGGSFIELD_API_KEY: "kid", HIGGSFIELD_API_SECRET: "sec" });
    expect(r?.credentials).toBe("kid:sec");
    expect(r?.shape).toBe("pair");
  });

  it("returns null when nothing is configured", () => {
    expect(resolveCredentials({})).toBeNull();
  });

  it("treats whitespace-only values as absent", () => {
    expect(resolveCredentials({ HIGGSFIELD_API_KEY: "   " })).toBeNull();
    expect(
      resolveCredentials({ HIGGSFIELD_API_KEY: " kid ", HIGGSFIELD_API_SECRET: " sec " }),
    ).toEqual({ credentials: "kid:sec", shape: "pair" });
  });

  it("passes the value through verbatim, inventing no colon", () => {
    // Whatever resolves goes straight after "Key " in the header.
    for (const v of ["abc", "a:b", "a:b:c", "Key-Looking-Value"]) {
      expect(resolveCredentials({ HIGGSFIELD_CREDENTIALS: v })?.credentials).toBe(v);
    }
  });
});

describe("higgsfieldConfigProblem", () => {
  it("is silent when nothing is configured, because that is a choice", () => {
    expect(higgsfieldConfigProblem({})).toBeNull();
  });

  it("is silent when the credential resolves, in any shape", () => {
    expect(higgsfieldConfigProblem({ HIGGSFIELD_API_KEY: "k" })).toBeNull();
    expect(higgsfieldConfigProblem({ HIGGSFIELD_API_KEY: "k", HIGGSFIELD_API_SECRET: "s" })).toBeNull();
    expect(higgsfieldConfigProblem({ HIGGSFIELD_CREDENTIALS: "k:s" })).toBeNull();
  });

  it("names the variables when configuration was attempted but cannot work", () => {
    const problem = higgsfieldConfigProblem({ HIGGSFIELD_API_KEY: "   " });
    expect(problem).toMatch(/HIGGSFIELD_API_KEY/);
    expect(problem).toMatch(/cannot be used/);
  });

  it("flags a secret with no key, which authenticates nothing on its own", () => {
    expect(higgsfieldConfigProblem({ HIGGSFIELD_API_SECRET: "sec" })).toMatch(
      /HIGGSFIELD_API_SECRET/,
    );
  });
});

describe("the confirmed addresses", () => {
  it("defaults to the API host, not the website", () => {
    // platform.higgsfield.ai is the site; api.higgsfield.ai is the API. Getting
    // this wrong broke every call, video included.
    vi.stubEnv("HIGGSFIELD_API_KEY", "hf_test");
    vi.stubEnv("HIGGSFIELD_BASE_URL", "");
    try {
      const cfg = higgsfieldConfigFromEnv();
      expect(cfg.baseUrl).toBe("https://api.higgsfield.ai");
      expect(cfg.credentials).toBe("hf_test"); // a lone key survives the round trip
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still lets the base URL be overridden without a deploy", () => {
    vi.stubEnv("HIGGSFIELD_API_KEY", "hf_test");
    vi.stubEnv("HIGGSFIELD_BASE_URL", "https://elsewhere.example");
    try {
      expect(higgsfieldConfigFromEnv().baseUrl).toBe("https://elsewhere.example");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the confirmed video and poll paths", () => {
    expect(pathFromEnv("video", {})).toBe("/v1/image2video/dop");
    expect(pathFromEnv("poll", {})).toBe("/requests/{id}/status");
  });

  it("gives the image endpoint no /v1 prefix", () => {
    // v2 model endpoints are the base plus a model slug, with no /v1;
    // v1 endpoints (video) keep theirs.
    const image = pathFromEnv("image", {});
    expect(image).toBe("/higgsfield-ai/soul/v2/image-to-image");
    expect(image.startsWith("/v1/")).toBe(false);
    expect(pathFromEnv("video", {}).startsWith("/v1/")).toBe(true);
  });
});

describe("toHiggsfieldBody", () => {
  const base = {
    conceptId: "c1",
    prompt: "Bottle on dark wood",
    sourceImageUrl: "https://cdn.example.com/bottle.jpg",
    placement: "reel" as const,
  };

  it("sends the image body FLAT, with image_url as a string", () => {
    // Probed 5 Nov 2026: /higgsfield-ai/soul/v2/image-to-image requires
    // `prompt` and `image_url` at the top level.
    const body = toHiggsfieldBody(buildRenderRequest({ ...base, kind: "image" }));
    expect(body).toEqual({
      prompt: "Bottle on dark wood",
      image_url: "https://cdn.example.com/bottle.jpg",
      aspect_ratio: "9:16",
    });
    expect(body.input).toBeUndefined(); // the key neither route actually has
    expect(body.params).toBeUndefined();
  });

  it("sends the video body NESTED under params, with input_images as a list", () => {
    // Probed: /v1/image2video/dop reports prompt and input_images missing at
    // loc ["body","params",...] — a different shape from the image route.
    const body = toHiggsfieldBody(
      buildRenderRequest({ ...base, kind: "video", durationSeconds: 8 }),
    ) as { params: Record<string, unknown> };
    expect(body.params).toMatchObject({
      prompt: "Bottle on dark wood",
      input_images: [{ type: "image_url", image_url: "https://cdn.example.com/bottle.jpg" }],
      model: "dop-turbo",
      duration: 8,
    });
    expect((body as Record<string, unknown>).input).toBeUndefined();
  });

  it("never nests the image body or flattens the video body", () => {
    // The old code sent { input: {...} } for both, which no route accepts.
    const image = toHiggsfieldBody(buildRenderRequest({ ...base, kind: "image" }));
    const video = toHiggsfieldBody(buildRenderRequest({ ...base, kind: "video" }));
    expect(Object.keys(image).sort()).toEqual(["aspect_ratio", "image_url", "prompt"]);
    expect(Object.keys(video)).toEqual(["params"]);
  });

  it("carries the placement's aspect ratio into both shapes", () => {
    const feedImage = toHiggsfieldBody(
      buildRenderRequest({ ...base, kind: "image", placement: "feed" }),
    );
    expect(feedImage.aspect_ratio).toBe("4:5");
    const feedVideo = toHiggsfieldBody(
      buildRenderRequest({ ...base, kind: "video", placement: "feed" }),
    ) as { params: { aspect_ratio: string } };
    expect(feedVideo.params.aspect_ratio).toBe("4:5");
  });

  it("defaults the image endpoint to a model that actually exists", () => {
    // GET /models lists 95 slugs and not one contains "flux" or "kontext".
    const path = pathFromEnv("image", {});
    expect(path).toBe("/higgsfield-ai/soul/v2/image-to-image");
    expect(path).not.toMatch(/kontext|flux/);
  });
});
