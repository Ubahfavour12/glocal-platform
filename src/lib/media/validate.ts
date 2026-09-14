/**
 * What a customer is allowed to upload, and why each rule exists.
 *
 * The bucket is PUBLIC and serves whatever is in it at a stable URL. That is
 * the fact everything here follows from: a file that reaches the bucket is a
 * file anyone on the internet can open, served from a domain associated with
 * us.
 *
 * An extension allowlist already existed in `mediaStoragePath`, which is why
 * .php and .svg were never reachable. What did not exist:
 *
 *  1. A SIZE LIMIT. Nothing stopped a customer uploading a 4GB file, repeatedly.
 *  2. HONEST CONTENT TYPE. The upload passed `file.type` straight through —
 *     the browser's claim about its own file, which a script can set to
 *     anything. Claiming `text/html` on a file named `.png` would have the
 *     bucket serve it as HTML, and HTML on a public URL runs JavaScript. That
 *     is the stored-XSS path, and it does not need a .php file to exist.
 *
 * So the content type is DERIVED from the allowlisted extension here, never
 * taken from the client. The extension is the thing we validated; it should
 * also be the thing that decides how the file is served.
 */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Extension → the type we will serve it as.
 *
 * Deliberately narrow. SVG is absent and must stay absent: it is an image that
 * can contain a <script> tag, so allowing it would reintroduce exactly the
 * stored-XSS hole the derived content type closes.
 */
export const ALLOWED: Record<string, { contentType: string; kind: "image" | "video" }> = {
  jpg: { contentType: "image/jpeg", kind: "image" },
  jpeg: { contentType: "image/jpeg", kind: "image" },
  png: { contentType: "image/png", kind: "image" },
  webp: { contentType: "image/webp", kind: "image" },
  mp4: { contentType: "video/mp4", kind: "video" },
  mov: { contentType: "video/quicktime", kind: "video" },
  webm: { contentType: "video/webm", kind: "video" },
};

export function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  // A file with no dot has no extension; "archive.tar.gz" is decided by its
  // last segment, which is what a server serving it would use too.
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

export type Rejection =
  | { ok: false; reason: "type"; message: string }
  | { ok: false; reason: "size"; message: string }
  | { ok: false; reason: "empty"; message: string };

export type Validation =
  | { ok: true; contentType: string; kind: "image" | "video"; extension: string }
  | Rejection;

/** Human sizes, because "15728640 bytes" is not a limit anyone can act on. */
function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/**
 * Decide whether this file may be stored, and how it must be served.
 *
 * Pure, so the rules are testable, and callable on both sides: in the browser
 * for an immediate, friendly refusal, and anywhere a server-side check is added
 * later. Client-side validation alone is a courtesy — the bucket's own limits
 * are what make it enforcement — so this returns the content type rather than
 * merely a yes/no, which is the part that holds even when the check is skipped.
 */
export function validateUpload(file: { name: string; size: number }): Validation {
  const extension = extensionOf(file.name);
  const allowed = ALLOWED[extension];
  if (!allowed) {
    return {
      ok: false,
      reason: "type",
      message: `${extension ? `.${extension} files` : "Files without a type"} can't be used. Try a JPG, PNG, WebP, MP4, MOV or WebM.`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, reason: "empty", message: "That file is empty." };
  }
  const cap = allowed.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > cap) {
    return {
      ok: false,
      reason: "size",
      message: `That ${allowed.kind} is ${mb(file.size)}. The limit is ${mb(cap)}.`,
    };
  }
  return { ok: true, contentType: allowed.contentType, kind: allowed.kind, extension };
}
