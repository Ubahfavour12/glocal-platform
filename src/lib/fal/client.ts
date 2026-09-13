/**
 * fal.ai creative rendering lane. Replaces Higgsfield as the engine (decision
 * 3 Aug 2026): same frontier models, API-first, per-generation pricing, and
 * model choice per job instead of one vendor's wrapper.
 *
 * Deliberately mirrors the shape of meta/client.ts and the old higgsfield
 * client: config from env, throws when unconfigured, pure request/response
 * mappers that are fixture-tested so the lane is verifiable offline.
 *
 * Contract (fal queue API):
 *   submit  POST https://queue.fal.run/{model}            -> { request_id }
 *   status  GET  https://queue.fal.run/{model}/requests/{id}/status
 *   result  GET  https://queue.fal.run/{model}/requests/{id}
 *   auth    Authorization: Key {FAL_KEY}
 *   states  IN_QUEUE | IN_PROGRESS | COMPLETED
 *
 * Model slugs are env-overridable on purpose. Generative models are replaced
 * every few months, and swapping one should be an env change, not a deploy.
 */

import { fetchWithTimeout, LONG_TIMEOUT_MS } from "@/lib/net/fetch";
const DEFAULT_BASE = "https://queue.fal.run";

/** Image-to-image: the customer's product photo is always the starting point. */
const DEFAULT_IMAGE_MODEL = "fal-ai/flux/dev/image-to-image";
/** Image-to-video: animates that same photo. */
const DEFAULT_VIDEO_MODEL = "fal-ai/kling-video/v2/standard/image-to-video";

export interface FalConfig {
  /** fal_sk_... from fal.ai -> Settings -> API Keys */
  apiKey: string;
  baseUrl: string;
  imageModel: string;
  videoModel: string;
}

export function falConfigFromEnv(): FalConfig {
  const apiKey = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
  if (!apiKey) throw new Error("FAL_KEY not configured");
  return {
    apiKey,
    baseUrl: process.env.FAL_BASE_URL || DEFAULT_BASE,
    imageModel: process.env.FAL_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    videoModel: process.env.FAL_VIDEO_MODEL || DEFAULT_VIDEO_MODEL,
  };
}

export type CreativeKind = "image" | "video";
export type Placement = "reel" | "story" | "feed" | "square";

/** Placement -> aspect ratio. Vertical for reels/stories, square-ish for feed. */
export function aspectRatioFor(placement: Placement): "9:16" | "1:1" | "4:5" {
  switch (placement) {
    case "reel":
    case "story":
      return "9:16";
    case "feed":
      return "4:5";
    case "square":
      return "1:1";
  }
}

/** fal names image sizes rather than taking raw ratios. */
export function falImageSize(ratio: "9:16" | "1:1" | "4:5"): string {
  switch (ratio) {
    case "9:16":
      return "portrait_16_9";
    case "4:5":
      return "portrait_4_3";
    case "1:1":
      return "square_hd";
  }
}

export interface RenderConceptInput {
  conceptId: string;
  /** The visual idea to realise (from the concept's hook / storyboard). */
  prompt: string;
  /** The customer's product photo, already stored and publicly readable. */
  sourceImageUrl: string;
  kind: CreativeKind;
  placement: Placement;
  /** Only for video; clamped to a sane range. */
  durationSeconds?: number;
}

const MIN_VIDEO_S = 5;
const MAX_VIDEO_S = 10;

/**
 * Pure: the JSON body fal expects for this job. Validation lives here so a bad
 * concept fails loudly before we spend a cent.
 */
export function buildFalBody(input: RenderConceptInput): Record<string, unknown> {
  if (!input.prompt.trim()) throw new Error("render prompt is empty");
  if (!/^https?:\/\//i.test(input.sourceImageUrl)) {
    throw new Error("sourceImageUrl must be an absolute URL");
  }
  const ratio = aspectRatioFor(input.placement);

  if (input.kind === "video") {
    const d = Math.round(input.durationSeconds ?? 5);
    return {
      prompt: input.prompt.trim(),
      image_url: input.sourceImageUrl,
      aspect_ratio: ratio,
      duration: String(Math.min(MAX_VIDEO_S, Math.max(MIN_VIDEO_S, d))),
    };
  }

  return {
    prompt: input.prompt.trim(),
    image_url: input.sourceImageUrl,
    image_size: falImageSize(ratio),
    // Keep the product recognisable: a high strength would redraw the item and
    // mangle labels, which is the fastest way to make an ad useless.
    strength: 0.65,
    num_images: 1,
    enable_safety_checker: true,
  };
}

export function modelFor(cfg: FalConfig, kind: CreativeKind): string {
  return kind === "video" ? cfg.videoModel : cfg.imageModel;
}

export type RenderState = "queued" | "processing" | "done" | "failed";

export interface RenderStatus {
  jobId: string;
  state: RenderState;
  mediaUrl?: string;
  error?: string;
}

interface RawStatus {
  request_id?: string;
  status?: string;
  error?: string | { message?: string };
  detail?: string | { msg?: string }[];
  // result payloads
  images?: { url?: string }[];
  image?: { url?: string };
  video?: { url?: string };
  url?: string;
}

const STATE_MAP: Record<string, RenderState> = {
  in_queue: "queued",
  queued: "queued",
  pending: "queued",
  in_progress: "processing",
  processing: "processing",
  running: "processing",
  completed: "done",
  succeeded: "done",
  done: "done",
  failed: "failed",
  error: "failed",
  canceled: "failed",
};

/** Pure: pull the first usable media URL out of any of fal's result shapes. */
export function mediaUrlFrom(raw: RawStatus): string | undefined {
  return (
    raw.video?.url ??
    raw.image?.url ??
    raw.images?.find((i) => i.url)?.url ??
    raw.url ??
    undefined
  );
}

/** Pure: normalise a raw fal status/result into our shape, defensively. */
export function parseRenderStatus(raw: RawStatus, fallbackJobId = ""): RenderStatus {
  const jobId = String(raw.request_id ?? fallbackJobId ?? "");
  const rawState = (raw.status ?? "").toString().toLowerCase();
  // A result payload carries media but no status field; treat that as done.
  const media = mediaUrlFrom(raw);
  const state: RenderState = rawState
    ? (STATE_MAP[rawState] ?? "processing")
    : media
      ? "done"
      : "processing";

  const error =
    typeof raw.error === "string"
      ? raw.error
      : raw.error?.message ??
        (typeof raw.detail === "string" ? raw.detail : undefined);

  return {
    jobId,
    state,
    mediaUrl: state === "done" ? media : undefined,
    error: state === "failed" ? (error ?? "render failed") : undefined,
  };
}

// ---------- network (thin; the mappers above hold the logic) ----------

function headers(cfg: FalConfig): Record<string, string> {
  return { authorization: `Key ${cfg.apiKey}`, "content-type": "application/json" };
}

export async function submitRender(
  cfg: FalConfig,
  input: RenderConceptInput,
): Promise<RenderStatus> {
  const model = modelFor(cfg, input.kind);
  const res = await fetchWithTimeout(`${cfg.baseUrl}/${model}`, {
    timeoutMs: LONG_TIMEOUT_MS,
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(buildFalBody(input)),
  });
  const data = (await res.json().catch(() => ({}))) as RawStatus & { message?: string };
  if (!res.ok) {
    throw new Error(`fal submit failed (${res.status}): ${data.message ?? JSON.stringify(data).slice(0, 200)}`);
  }
  return parseRenderStatus(data);
}

/**
 * Poll a job. fal splits status and result across two endpoints, so a completed
 * job needs a second fetch to get the media URL.
 */
export async function pollRender(
  cfg: FalConfig,
  jobId: string,
  kind: CreativeKind = "image",
): Promise<RenderStatus> {
  const model = modelFor(cfg, kind);
  const res = await fetchWithTimeout(`${cfg.baseUrl}/${model}/requests/${jobId}/status`, {
    timeoutMs: LONG_TIMEOUT_MS,
    headers: headers(cfg),
  });
  const data = (await res.json().catch(() => ({}))) as RawStatus & { message?: string };
  if (!res.ok) {
    throw new Error(`fal poll failed (${res.status}): ${data.message ?? res.status}`);
  }
  const status = parseRenderStatus(data, jobId);
  if (status.state !== "done") return status;

  const resultRes = await fetchWithTimeout(`${cfg.baseUrl}/${model}/requests/${jobId}`, {
    timeoutMs: LONG_TIMEOUT_MS,
    headers: headers(cfg),
  });
  const result = (await resultRes.json().catch(() => ({}))) as RawStatus;
  if (!resultRes.ok) {
    return { jobId, state: "failed", error: "render finished but the result could not be read" };
  }
  const media = mediaUrlFrom(result);
  return media
    ? { jobId, state: "done", mediaUrl: media }
    : { jobId, state: "failed", error: "render finished with no media" };
}
