/**
 * Meta webhook intake for ad review events — Slice C.
 * Pure functions: signature verification (X-Hub-Signature-256) and a tolerant
 * parser that extracts DISAPPROVED ads from Meta's change notifications.
 * The route wraps these with DB writes; nothing here touches the network.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify Meta's X-Hub-Signature-256 header over the RAW request body. */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AdRejectionEvent {
  platformAdId: string;
  /** Human-readable reason assembled from the payload; may be empty. */
  reason: string;
}

interface WebhookChange {
  field?: string;
  value?: {
    id?: string | number;
    ad_id?: string | number;
    ad_object_id?: string | number;
    effective_status?: string;
    review_feedback?: Record<string, unknown> | string;
    reason?: string;
    [k: string]: unknown;
  };
}

interface WebhookPayload {
  object?: string;
  entry?: { id?: string; changes?: WebhookChange[] }[];
}

const DISAPPROVED_STATUSES = new Set(["DISAPPROVED", "WITH_ISSUES", "REJECTED"]);

function reasonFrom(value: NonNullable<WebhookChange["value"]>): string {
  if (typeof value.reason === "string" && value.reason) return value.reason;
  const rf = value.review_feedback;
  if (typeof rf === "string") return rf;
  if (rf && typeof rf === "object") {
    // Meta nests policy names under review_feedback keys/values; flatten them.
    const parts: string[] = [];
    for (const [k, v] of Object.entries(rf)) {
      parts.push(typeof v === "string" ? `${k}: ${v}` : k);
    }
    if (parts.length) return parts.join("; ");
  }
  return "";
}

/**
 * Extract ad-rejection events from a Meta webhook payload. Tolerant by design:
 * unknown fields are ignored, and an event without a recognisable ad id is
 * dropped rather than crashing the intake.
 */
export function parseAdRejections(payload: unknown): AdRejectionEvent[] {
  const p = payload as WebhookPayload | null;
  if (!p?.entry?.length) return [];
  const events: AdRejectionEvent[] = [];
  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      const status = (v.effective_status ?? "").toString().toUpperCase();
      const looksRejected =
        DISAPPROVED_STATUSES.has(status) ||
        change.field === "with_issues_ad_objects" ||
        v.review_feedback !== undefined;
      if (!looksRejected) continue;
      const rawId = v.ad_id ?? v.ad_object_id ?? v.id;
      if (rawId === undefined || rawId === null || rawId === "") continue;
      events.push({ platformAdId: String(rawId), reason: reasonFrom(v) });
    }
  }
  return events;
}
