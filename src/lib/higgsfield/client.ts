/**
 * Higgsfield creative rendering lane — Phase 2 (Blueprint §3 "Production").
 * Turns a scripted concept plus the customer's product photo into a finished
 * image or video ad. Structured like meta/client.ts: config from env, throws
 * when unconfigured, pure request/response helpers that are fixture-tested so
 * the lane is verifiable offline and lights up the moment the key lands.
 *
 * HOW MUCH OF THIS IS ACTUALLY VERIFIED (read before debugging a failure).
 * Checked 5 Nov 2026 against the official SDK README
 * (github.com/higgsfield-ai/higgsfield-js) and Higgsfield's API docs index.
 *
 *   CONFIRMED
 *     Base URL  https://api.higgsfield.ai  — the SDK sets this as its default.
 *       An earlier version of this file used platform.higgsfield.ai, which is
 *       the website, not the API. That broke every call, video included.
 *     Auth      `Authorization: Key <credential>`. The credential is a
 *       KEY_ID:KEY_SECRET pair in the SDK and a single key in the quick-start.
 *       Both are real; the account decides. resolveCredentials takes either.
 *     Video     /v1/image2video/dop, with `model: "dop-turbo"` in the input.
 *     Poll      /requests/{id}/status
 *     Body      { input: { prompt, aspect_ratio, input_images: [...] } }, where
 *       each input image is { type: "image_url", image_url: "..." }.
 *     Statuses  queued, in_progress, nsfw, failed, completed — and mapped
 *       defensively either way, so an unknown status reads as "processing"
 *       rather than throwing: a renamed status delays a job, never loses one.
 *
 *   NOT CONFIRMED — the image endpoint's last segment.
 *     The docs show v2 model endpoints as the base plus an endpoint id with NO
 *     /v1 prefix (marketing-studio/image, xai/grok-imagine-image-2.0), while v1
 *     endpoints keep theirs. The Kontext family is real: the SDK uses
 *     `flux-pro/kontext/max/text-to-image`. So the default below drops the /v1
 *     this file used to carry, and `image-to-image` is inferred from the
 *     text-to-image sibling. If it 404s, the sibling is the fallback to try.
 *
 *     An earlier note here claimed the slug was "almost certainly wrong"
 *     because Higgsfield's model catalogue lists no flux-kontext model. That
 *     reasoning was wrong: the catalogue is the consumer app's surface, not the
 *     REST API's, so it was never evidence about this.
 *
 * Every path is overridable by env (see PATHS) so a wrong slug is a 30-second
 * fix in the hosting dashboard, not a code change and a deploy. The pure
 * mappers are fixture-tested, so what is tested here is the shape of the
 * request and the reading of the response, NOT the addresses.
 */

import { fetchWithTimeout, LONG_TIMEOUT_MS } from "@/lib/net/fetch";
const DEFAULT_BASE = "https://api.higgsfield.ai";

export interface HiggsfieldConfig {
  /** Whatever follows "Key " in the Authorization header, verbatim. */
  credentials: string;
  baseUrl: string;
}

/**
 * Which shape the configured credential turned out to be. Diagnostics only —
 * it never changes the header, which is always `Key ` + the resolved value.
 */
export type CredentialShape = "pair" | "combined" | "single";

export interface ResolvedCredentials {
  credentials: string;
  shape: CredentialShape;
}

const str = (v: string | undefined): string => (v ?? "").trim();

/**
 * Pure: work out the credential from whatever the dashboard handed over.
 *
 * WHY THIS IS NOT JUST A PAIR. Higgsfield documents its auth two different
 * ways: the official SDK uses `Key KEY_ID:KEY_SECRET`, and the quick-start uses
 * `Key <api-key>`, a single value. Both appear to be real and the account
 * decides which you get — this one issues a single key with no colon.
 *
 * The previous version accepted only the pair, so a lone key resolved to the
 * empty string, `higgsfieldConfigFromEnv` threw, `higgsfieldEngine()` caught it
 * and returned null, and a correctly-configured key was indistinguishable from
 * no key at all. Every render went to fal and nothing said why.
 *
 * So all four shapes resolve, and the founder never has to care which one his
 * dashboard gives him — now or on a key rotation.
 */
export function resolveCredentials(
  env: Record<string, string | undefined> = process.env,
): ResolvedCredentials | null {
  const combined = str(env.HIGGSFIELD_CREDENTIALS);
  if (combined) {
    return { credentials: combined, shape: combined.includes(":") ? "combined" : "single" };
  }
  const key = str(env.HIGGSFIELD_API_KEY);
  const secret = str(env.HIGGSFIELD_API_SECRET);
  if (key && secret) return { credentials: `${key}:${secret}`, shape: "pair" };
  // A whole pair pasted into the key field, or a single key. Either way the
  // value is already exactly what goes after "Key ".
  if (key) return { credentials: key, shape: key.includes(":") ? "combined" : "single" };
  return null;
}

/**
 * Pure: a plain-language reason the configuration is unusable, or null.
 *
 * Nothing configured is NOT a problem — leaving an engine off is a choice. This
 * is only for configuration that was attempted and cannot work, which is the
 * case that used to be silent.
 */
export function higgsfieldConfigProblem(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (resolveCredentials(env)) return null;
  const present = ["HIGGSFIELD_CREDENTIALS", "HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET"].filter(
    (n) => (env[n] ?? "") !== "",
  );
  if (present.length === 0) return null; // deliberately not configured
  return `${present.join(" and ")} set but empty or whitespace, so Higgsfield cannot be used.`;
}

export function higgsfieldConfigFromEnv(): HiggsfieldConfig {
  const resolved = resolveCredentials();
  if (!resolved) {
    throw new Error(
      "Higgsfield not configured: set HIGGSFIELD_API_KEY (a single key is fine), " +
        "or HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET, or HIGGSFIELD_CREDENTIALS.",
    );
  }
  return {
    credentials: resolved.credentials,
    baseUrl: str(process.env.HIGGSFIELD_BASE_URL) || DEFAULT_BASE,
  };
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
  image: { env: "HIGGSFIELD_IMAGE_PATH", fallback: "/flux-pro/kontext/max/image-to-image" },
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
