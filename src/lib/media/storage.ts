/**
 * Product media storage — Phase 2.3 prerequisite.
 * The customer's product photos are the raw material the render lane turns
 * into ads, so (unlike the onboarding preview) they must be STORED. Uploads
 * land in the public `product-media` bucket under the business's own folder;
 * a media_assets row indexes them. The most recent image is the render source.
 *
 * Thin Supabase Storage bindings around a couple of pure, tested helpers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { renderCostUsdMinor } from "@/lib/creative/pricing";
import type { RenderKind } from "@/lib/creative/quota";

export const MEDIA_BUCKET = "product-media";

const EXT_OK = new Set(["jpg", "jpeg", "png", "webp", "mp4", "mov", "webm"]);

/** Pure: safe storage path `${businessId}/${random}.${ext}`, ext validated. */
export function mediaStoragePath(businessId: string, filename: string, rand: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!EXT_OK.has(ext)) throw new Error(`unsupported media type: .${ext}`);
  return `${businessId}/${rand}.${ext}`;
}

export function kindFromFilename(filename: string): "image" | "video" {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return ["mp4", "mov", "webm"].includes(ext) ? "video" : "image";
}

export interface MediaAsset {
  id: string;
  publicUrl: string;
  kind: "image" | "video";
  storagePath: string;
}

/** Upload one file (client-side) and index it. RLS scopes media_assets to the owner. */
export async function uploadProductMedia(
  supabase: SupabaseClient,
  businessId: string,
  file: File,
): Promise<MediaAsset> {
  const path = mediaStoragePath(businessId, file.name, crypto.randomUUID());
  const kind = kindFromFilename(file.name);

  const { error: upErr } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (upErr) throw new Error(upErr.message);

  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { data, error } = await supabase
    .from("media_assets")
    .insert({ business_id: businessId, storage_path: path, public_url: publicUrl, kind })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { id: data.id as string, publicUrl, kind, storagePath: path };
}

/** Remove one asset: delete the file, then its index row (RLS-scoped to owner). */
export async function deleteProductMedia(
  supabase: SupabaseClient,
  assetId: string,
  storagePath: string,
): Promise<void> {
  await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
  const { error } = await supabase.from("media_assets").delete().eq("id", assetId);
  if (error) throw new Error(error.message);
}

/** The render source: the most recent image the business uploaded, if any. */
export async function getSourceImageUrl(
  supabase: SupabaseClient,
  businessId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("media_assets")
    .select("public_url")
    .eq("business_id", businessId)
    .eq("kind", "image")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.public_url as string) ?? null;
}

/** Count renders already produced for a business today (quota accounting). */
export async function countRendersToday(
  supabase: SupabaseClient,
  businessId: string,
): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("creatives")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .not("media_url", "is", null)
    .gte("created_at", since.toISOString());
  return count ?? 0;
}

/** Persist a finished render as a creatives row. */
export async function persistRenderedCreative(
  supabase: SupabaseClient,
  businessId: string,
  conceptId: string,
  mediaUrl: string,
  /** Which engine produced it, so duel verdicts can be read per engine. */
  engine?: "fal" | "higgsfield",
  /** What it cost, so the video economics stop being a guess in a chat log. */
  kind?: RenderKind,
): Promise<void> {
  await supabase.from("creatives").insert({
    business_id: businessId,
    concept_id: conceptId,
    state: "ready",
    media_url: mediaUrl,
    ...(engine ? { engine } : {}),
    ...(engine && kind
      ? { render_cost_usd_minor: renderCostUsdMinor(engine, kind) }
      : {}),
  });
}
