/**
 * Higgsfield creative rendering lane — Phase 2 (Blueprint §3 "Production").
 * Turns a scripted concept plus the customer's product photo into a finished
 * image or video ad. Structured like meta/client.ts: config from env, throws
 * when unconfigured, pure request/response helpers that are fixture-tested so
 * the lane is verifiable offline and lights up the moment the key lands.
 *
 * The exact Higgsfield endpoints/field names are confirmed at integration
 * (same approach we took with pricing); the async job shape below — submit a
 * job, poll for the asset URL — matches every media-generation API in this
 * class, and the pure mappers are what the tests pin down.
 */

const DEFAULT_BASE = "https://api.higgsfield.ai/v1";

export interface HiggsfieldConfig {
  apiKey: string;
  baseUrl: string;
}

export function higgsfieldConfigFromEnv(): HiggsfieldConfig {
  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) throw new Error("HIGGSFIELD_API_KEY not configured");
  return { apiKey, baseUrl: process.env.HIGGSFIELD_BASE_URL || DEFAULT_BASE };
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
  status?: string;
  state?: string;
  result?: { assets?: { url?: string }[]; url?: string };
  output_url?: string;
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
};

/** Pure: normalise a raw job status into our shape, defensively. */
export function parseRenderStatus(raw: RawStatus): RenderStatus {
  const jobId = String(raw.id ?? raw.job_id ?? "");
  const rawState = (raw.status ?? raw.state ?? "").toString().toLowerCase();
  const state = STATE_MAP[rawState] ?? "processing";
  const mediaUrl =
    raw.output_url ?? raw.result?.url ?? raw.result?.assets?.find((a) => a.url)?.url ?? undefined;
  const error =
    typeof raw.error === "string" ? raw.error : raw.error?.message ?? undefined;
  return {
    jobId,
    state,
    mediaUrl: state === "done" ? mediaUrl : undefined,
    error: state === "failed" ? error ?? "render failed" : undefined,
  };
}

// ---------- network (thin; the mappers above hold the logic) ----------

export async function submitRender(
  cfg: HiggsfieldConfig,
  input: RenderConceptInput,
): Promise<RenderStatus> {
  const res = await fetch(`${cfg.baseUrl}/renders`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildRenderRequest(input)),
  });
  const data = (await res.json()) as RawStatus & { message?: string };
  if (!res.ok) throw new Error(`Higgsfield submit failed: ${data.message ?? res.status}`);
  return parseRenderStatus(data);
}

export async function pollRender(cfg: HiggsfieldConfig, jobId: string): Promise<RenderStatus> {
  const res = await fetch(`${cfg.baseUrl}/renders/${jobId}`, {
    headers: { authorization: `Bearer ${cfg.apiKey}` },
  });
  const data = (await res.json()) as RawStatus & { message?: string };
  if (!res.ok) throw new Error(`Higgsfield poll failed: ${data.message ?? res.status}`);
  return parseRenderStatus(data);
}
