/**
 * Higgsfield creative rendering lane — Phase 2 (Blueprint §3 "Production").
 * Turns a scripted concept plus the customer's product photo into a finished
 * image or video ad. Structured like meta/client.ts: config from env, throws
 * when unconfigured, pure request/response helpers that are fixture-tested so
 * the lane is verifiable offline and lights up the moment the key lands.
 *
 * HOW MUCH OF THIS IS ACTUALLY VERIFIED (read before debugging a failure).
 * This header used to say "Verified against Higgsfield's official API
 * 2026-07-24". That claim was too broad and one part of it is now known wrong,
 * so here is the honest state, checked 5 Nov 2026:
 *
 *   Auth header `Key <id>:<secret>` — corroborated by Higgsfield's own
 *     quick-start and by third-party write-ups. Treat as right.
 *   Status values (queued, in_progress, nsfw, failed, completed) — mapped
 *     defensively either way: an unknown status reads as "processing" rather
 *     than throwing, so a renamed status delays a job, never loses one.
 *   Base URL — SUSPECT. Higgsfield's quick-start points REST at
 *     api.higgsfield.ai and calls platform/open the website, and warns that
 *     its own docs still link older domains. DEFAULT_BASE below is the old
 *     one. HIGGSFIELD_BASE_URL overrides it without a deploy.
 *   Image path — WRONG, almost certainly. `/v1/flux-pro/kontext/max/
 *     image-to-image` is fal.ai's slug shape (`fal-ai/flux-pro/kontext/max`),
 *     and Higgsfield's live model catalogue lists no flux-kontext model at
 *     all — it has flux_2 and flux_3_image, addressed by model id. This looks
 *     copied from the fal client, which is why it was never confirmable.
 *   Video path and the poll path — unconfirmed, same provenance.
 *
 * Every path is therefore overridable by env (see PATHS below) so a wrong slug
 * is a 30-second fix in the hosting dashboard, not a code change and a deploy.
 * The pure mappers are fixture-tested, so what is tested here is the shape of
 * the request and the reading of the response, NOT the addresses.
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

/**
 * Endpoint paths, overridable without a deploy.
 *
 * Config is allowed to decide these for the same reason it decides the primary
 * engine: a wrong value cannot move money or corrupt data. The worst case is a
 * render that fails and says why. The addresses are unverified (see header), so
 * the ability to correct them from the dashboard is worth one env var each.
 */
const PATHS = {
  video: { env: "HIGGSFIELD_VIDEO_PATH", fallback: "/v1/image2video/dop" },
  image: { env: "HIGGSFIELD_IMAGE_PATH", fallback: "/v1/flux-pro/kontext/max/image-to-image" },
  poll: { env: "HIGGSFIELD_POLL_PATH", fallback: "/requests/{id}/status" },
} as const;

/** Pure: read a path from config, falling back to the compiled-in default. */
export function pathFromEnv(
  key: keyof typeof PATHS,
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = (env[PATHS[key].env] ?? "").trim();
  // Must look like a path. A bare host or a full URL here would silently
  // produce a nonsense address, so an unusable value is ignored rather than
  // concatenated.
  return raw.startsWith("/") ? raw : PATHS[key].fallback;
}

/** Higgsfield endpoint for a creative kind. */
function endpointFor(kind: CreativeKind): string {
  return pathFromEnv(kind === "video" ? "video" : "image");
}

/** Poll path for a job id. `{id}` is substituted; appended if absent. */
export function pollPathFor(
  jobId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const template = pathFromEnv("poll", env);
  const encoded = encodeURIComponent(jobId);
  return template.includes("{id}")
    ? template.replace("{id}", encoded)
    : `${template.replace(/\/$/, "")}/${encoded}`;
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

/**
 * Pure: turn a failed response into a message that says what to fix.
 *
 * The old version called `res.json()` before checking `res.ok`, which is the
 * wrong order against an API whose addresses are unverified. A wrong path
 * returns an HTML 404, `json()` throws SyntaxError, and the only thing that
 * reached the journal was "Unexpected token '<'" — the status code, the path
 * and the vendor's own message all lost, for the one failure most likely to
 * happen on first run.
 *
 * So: status first, then the body as text, then JSON only if it parses. The
 * path is named because the path is the suspect; the body is capped because
 * an HTML error page would otherwise land whole in the journal; and the key
 * never appears, because this text ends up in logs.
 */
export function describeFailure(
  what: "submit" | "poll",
  status: number,
  path: string,
  body: string,
): string {
  let detail = body.trim().slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string; detail?: string; error?: string };
    detail = (parsed.message ?? parsed.detail ?? parsed.error ?? detail).toString().slice(0, 300);
  } catch {
    // Not JSON — an HTML error page or empty body. Keep the trimmed text.
  }
  const hint =
    status === 404
      ? ` — 404 means this path is wrong, not that Higgsfield is down; override it with ${PATHS[what === "submit" ? "image" : "poll"].env} or HIGGSFIELD_BASE_URL`
      : status === 401 || status === 403
        ? " — check HIGGSFIELD_CREDENTIALS is KEY_ID:KEY_SECRET"
        : status === 402 || status === 429
          ? " — out of credits or rate limited"
          : "";
  return `Higgsfield ${what} failed: ${status} at ${path}${detail ? ` (${detail})` : ""}${hint}`;
}

/** Read a response body once, as text, without ever throwing. */
async function bodyText(res: { text: () => Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function submitRender(
  cfg: HiggsfieldConfig,
  input: RenderConceptInput,
): Promise<RenderStatus> {
  const req = buildRenderRequest(input);
  const path = endpointFor(input.kind);
  const res = await fetchWithTimeout(`${cfg.baseUrl}${path}`, {
    timeoutMs: LONG_TIMEOUT_MS,
    method: "POST",
    headers: { authorization: `Key ${cfg.credentials}`, "content-type": "application/json" },
    body: JSON.stringify(toHiggsfieldBody(req)),
  });
  const text = await bodyText(res);
  if (!res.ok) throw new Error(describeFailure("submit", res.status, path, text));
  return parseRenderStatus(parseJsonOr({}, text));
}

export async function pollRender(cfg: HiggsfieldConfig, jobId: string): Promise<RenderStatus> {
  const path = pollPathFor(jobId);
  const res = await fetchWithTimeout(`${cfg.baseUrl}${path}`, {
    timeoutMs: LONG_TIMEOUT_MS,
    headers: { authorization: `Key ${cfg.credentials}` },
  });
  const text = await bodyText(res);
  if (!res.ok) throw new Error(describeFailure("poll", res.status, path, text));
  return parseRenderStatus(parseJsonOr({}, text));
}

/**
 * Parse JSON or give back the fallback.
 *
 * A 200 carrying a non-JSON body is not worth throwing over: parseRenderStatus
 * is already defensive and reads an empty object as "processing", so the job
 * gets polled again instead of being failed on a malformed reply.
 */
function parseJsonOr<T>(fallback: T, text: string): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}
