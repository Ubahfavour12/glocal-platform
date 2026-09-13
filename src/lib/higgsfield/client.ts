/**
 * Higgsfield creative rendering lane — Phase 2 (Blueprint §3 "Production").
 * Turns a scripted concept plus the customer's product photo into a finished
 * image or video ad. Structured like meta/client.ts: config from env, throws
 * when unconfigured, pure request/response helpers that are fixture-tested so
 * the lane is verifiable offline and lights up the moment the key lands.
 *
 * Verified against Higgsfield's official API 2026-07-24: base
 * platform.higgsfield.ai, "Authorization: Key KEY_ID:KEY_SECRET", image2video
 * at /v1/image2video/dop, polling at /requests/{id}/status (statuses queued,
 * in_progress, nsfw, failed, completed). The pure mappers are fixture-tested;
 * the image-to-image slug is the one field still confirmed at first live run.
 */

import { fetchWithTimeout, LONG_TIMEOUT_MS } from "@/lib/net/fetch";
const DEFAULT_BASE = "https://platform.higgsfield.ai";

export interface HiggsfieldConfig {
  /** "KEY_ID:KEY_SECRET" from cloud.higgsfield.ai → API */
  credentials: string;
  baseUrl: string;
}

export function higgsfieldConfigFromEnv(): HiggsfieldConfig {
  const credentials =
    process.env.HIGGSFIELD_CREDENTIALS ||
    (process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET
      ? `${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}`
      : "");
  if (!credentials) {
    throw new Error("HIGGSFIELD_CREDENTIALS (KEY_ID:KEY_SECRET) not configured");
  }
  return { credentials, baseUrl: process.env.HIGGSFIELD_BASE_URL || DEFAULT_BASE };
}

/** Higgsfield endpoint for a creative kind (image-to-image slug confirmed live). */
function endpointFor(kind: CreativeKind): string {
  return kind === "video"
    ? "/v1/image2video/dop"
    : "/v1/flux-pro/kontext/max/image-to-image";
}

export type CreativeKind = "image" | "video";
export type Placement = "reel" | "story" | "feed" | "square";

/** Placement → aspect ratio. Vertical for reels/stories, square for feed. */
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

export interface RenderRequest {
  concept_id: string;
  prompt: string;
  image_url: string;
  output: CreativeKind;
  aspect_ratio: string;
  duration_seconds?: number;
}

const MIN_VIDEO_S = 5;
const MAX_VIDEO_S = 30;

/** Pure: build the render job payload. Enforces sane video duration. */
export function buildRenderRequest(input: RenderConceptInput): RenderRequest {
  if (!input.prompt.trim()) throw new Error("render prompt is empty");
  if (!/^https?:\/\//i.test(input.sourceImageUrl)) {
    throw new Error("sourceImageUrl must be an absolute URL");
  }
  const req: RenderRequest = {
    concept_id: input.conceptId,
    prompt: input.prompt.trim(),
    image_url: input.sourceImageUrl,
    output: input.kind,
    aspect_ratio: aspectRatioFor(input.placement),
  };
  if (input.kind === "video") {
    const d = Math.round(input.durationSeconds ?? 8);
    req.duration_seconds = Math.min(MAX_VIDEO_S, Math.max(MIN_VIDEO_S, d));
  }
  return req;
}

export type RenderState = "queued" | "processing" | "done" | "failed";

export interface RenderStatus {
  jobId: string;
  state: RenderState;
  mediaUrl?: string;
  error?: string;
}

interface RawStatus {
  id?: string;
  job_id?: string;
  request_id?: string;
  status?: string;
  state?: string;
  result?: { assets?: { url?: string }[]; url?: string };
  results?: { url?: string }[];
  output_url?: string;
  video_url?: string;
  image_url?: string;
  error?: string | { message?: string };
}

const STATE_MAP: Record<string, RenderState> = {
  queued: "queued",
  pending: "queued",
  processing: "processing",
  running: "processing",
  in_progress: "processing",
  completed: "done",
  succeeded: "done",
  done: "done",
  failed: "failed",
  error: "failed",
  canceled: "failed",
  nsfw: "failed", // Higgsfield blocks unsafe content with this status
};

/** Pure: normalise a raw job status into our shape, defensively. */
export function parseRenderStatus(raw: RawStatus): RenderStatus {
  const jobId = String(raw.request_id ?? raw.id ?? raw.job_id ?? "");
  const rawState = (raw.status ?? raw.state ?? "").toString().toLowerCase();
  const state = STATE_MAP[rawState] ?? "processing";
  const mediaUrl =
    raw.video_url ??
    raw.image_url ??
    raw.output_url ??
    raw.result?.url ??
    raw.result?.assets?.find((a) => a.url)?.url ??
    raw.results?.find((r) => r.url)?.url ??
    undefined;
  const error =
    typeof raw.error === "string"
      ? raw.error
      : raw.error?.message ?? (rawState === "nsfw" ? "blocked as unsafe content" : undefined);
  return {
    jobId,
    state,
    mediaUrl: state === "done" ? mediaUrl : undefined,
    error: state === "failed" ? error ?? "render failed" : undefined,
  };
}

// ---------- network (thin; the mappers above hold the logic) ----------

/** Map our validated request into Higgsfield's `input` body. */
function toHiggsfieldBody(req: ReturnType<typeof buildRenderRequest>) {
  const input: Record<string, unknown> = {
    prompt: req.prompt,
    aspect_ratio: req.aspect_ratio,
    input_images: [{ type: "image_url", image_url: req.image_url }],
  };
  if (req.output === "video") {
    input.model = "dop-turbo";
    if (req.duration_seconds) input.duration = req.duration_seconds;
  }
  return { input };
}

export async function submitRender(
  cfg: HiggsfieldConfig,
  input: RenderConceptInput,
): Promise<RenderStatus> {
  const req = buildRenderRequest(input);
  const res = await fetchWithTimeout(`${cfg.baseUrl}${endpointFor(input.kind)}`, {
    timeoutMs: LONG_TIMEOUT_MS,
    method: "POST",
    headers: { authorization: `Key ${cfg.credentials}`, "content-type": "application/json" },
    body: JSON.stringify(toHiggsfieldBody(req)),
  });
  const data = (await res.json()) as RawStatus & { message?: string };
  if (!res.ok) throw new Error(`Higgsfield submit failed: ${data.message ?? res.status}`);
  return parseRenderStatus(data);
}

export async function pollRender(cfg: HiggsfieldConfig, jobId: string): Promise<RenderStatus> {
  const res = await fetchWithTimeout(`${cfg.baseUrl}/requests/${jobId}/status`, {
    timeoutMs: LONG_TIMEOUT_MS,
    headers: { authorization: `Key ${cfg.credentials}` },
  });
  const data = (await res.json()) as RawStatus & { message?: string };
  if (!res.ok) throw new Error(`Higgsfield poll failed: ${data.message ?? res.status}`);
  return parseRenderStatus(data);
}
