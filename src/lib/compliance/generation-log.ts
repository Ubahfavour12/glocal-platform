/**
 * The record of what this system generated, for the EU AI Act.
 *
 * The Act's transparency duties attach to content a model produced that a
 * person then consumes — every ad creative here — and they follow the
 * CONSUMER's location, not ours. We already have GB-registered customers, so
 * this is a present obligation rather than a future one.
 *
 * Labelling that content is a product decision with a commercial cost, and the
 * founder's to make. This is the part that is not a decision: a durable record
 * of what was produced, when, by which model, and from what. A regulator's
 * question gets an answer instead of a shrug.
 *
 * WHAT IS DELIBERATELY NOT STORED: the whole prompt. A hash plus a short
 * excerpt is enough to prove what was asked and to match a complaint to a
 * generation, without this table becoming a second copy of every customer's
 * business strategy — which would be its own disclosure risk, created in the
 * name of compliance.
 *
 * Recording NEVER blocks generation. A creative that was made but not logged is
 * a gap in evidence; a creative that failed to be made because the log was
 * down is a broken product. Failures are logged loudly instead.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

export type GenerationKind = "image" | "video" | "text";

export interface GenerationRecord {
  businessId: string;
  creativeId?: string | null;
  /** Vendor: "anthropic", "fal", "higgsfield". */
  provider: string;
  /** The specific model id — "fal" is not an answer to "which model wrote this". */
  model: string;
  kind: GenerationKind;
  /** The prompt or brief. Hashed and excerpted here, never stored whole. */
  input?: string | null;
  /** Where the output lives, if anywhere durable. */
  outputRef?: string | null;
  costUsdMinor?: number | null;
}

/** How much of the input is kept verbatim. Enough to recognise, not to reconstruct. */
export const EXCERPT_LENGTH = 200;

export function hashInput(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function excerpt(input: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  return clean.length <= EXCERPT_LENGTH ? clean : `${clean.slice(0, EXCERPT_LENGTH)}…`;
}

/** Shape one record for storage. Pure, so the redaction rules are testable. */
export function toRow(r: GenerationRecord): Record<string, unknown> {
  const input = r.input?.trim() ? r.input : null;
  return {
    business_id: r.businessId,
    creative_id: r.creativeId ?? null,
    provider: r.provider,
    model: r.model,
    kind: r.kind,
    input_sha256: input ? hashInput(input) : null,
    input_excerpt: input ? excerpt(input) : null,
    output_ref: r.outputRef ?? null,
    cost_usd_minor: r.costUsdMinor ?? null,
  };
}

/**
 * Write one generation to the log.
 *
 * Needs a service-role client: the table is append-only and has no insert
 * policy, so a customer cannot forge or suppress their own record.
 */
export async function recordGeneration(
  supabase: SupabaseClient,
  record: GenerationRecord,
): Promise<{ recorded: boolean }> {
  try {
    const { error } = await supabase.from("ai_generations").insert(toRow(record));
    if (error) throw new Error(error.message);
    return { recorded: true };
  } catch (e) {
    log.error("generation.log_failed", {
      businessId: record.businessId,
      provider: record.provider,
      model: record.model,
      error: e,
    });
    return { recorded: false };
  }
}
