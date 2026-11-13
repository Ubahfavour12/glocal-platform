/**
 * Product media storage — Phase 2.3 prerequisite.
 * The customer's product photos are the raw material the render lane turns
 * into ads, so (unlike the onboarding preview) they must be STORED. Uploads
 * land in the public `product-media` bucket under the business's own folder;
 * a media_assets row indexes them. The most recent image is the render source.
 *
 * Thin Supabase Storage bindings around a couple of pure, tested helpers.
 */

import { recordGeneration } from "@/lib/compliance/generation-log";
import { ALLOWED, extensionOf, validateUpload } from "./validate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderCostUsdMinor } from "@/lib/creative/pricing";
import type { RenderKind } from "@/lib/creative/quota";

export const MEDIA_BUCKET = "product-media";

/** Pure: safe storage path `${businessId}/${random}.${ext}`, ext validated. */
export function mediaStoragePath(businessId: string, filename: string, rand: string): string {
  const ext = extensionOf(filename);
  if (!ALLOWED[ext]) throw new Error(`unsupported media type: .${ext}`);
  return `${businessId}/${rand}.${ext}`;
}

export function kindFromFilename(filename: string): "image" | "video" {
  return ALLOWED[extensionOf(filename)]?.kind ?? "image";
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
  const check = validateUpload(file);
  if (!check.ok) throw new Error(check.message);

  const path = mediaStoragePath(businessId, file.name, crypto.randomUUID());
  const kind = check.kind;

  const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    upsert: false,
    // DERIVED from the validated extension, never `file.type`. The browser's
    // claim about its own file is attacker-controlled, and this bucket is
    // public: a file served as text/html from our domain runs JavaScript.
    contentType: check.contentType,
  });
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

/**
 * Pure: is this a path inside the business's own folder, and nothing else?
 *
 * `media_assets` rows are written by the customer's own browser session, so
 * every column in them is the customer's say-so. This is the check that makes
 * a stored path safe to turn into a URL: it must sit directly inside the
 * folder named after the business, be a single file name of the shape upload
 * produces, and carry an extension we accept. No slashes beyond the one, no
 * dot-dot, no query string -- nothing that could make the derived URL point
 * anywhere but one object in one folder of our own bucket.
 */
export function ownedStoragePath(businessId: string, path: string | null | undefined): string | null {
  if (!path) return null;
  const prefix = `${businessId}/`;
  if (!path.startsWith(prefix)) return null;
  const file = path.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{2,5}$/.test(file)) return null;
  if (!ALLOWED[extensionOf(file)]) return null;
  return path;
}

/**
 * The render source: the most recent image the business uploaded, if any.
 *
 * DERIVED FROM THE PATH, NOT READ FROM `public_url`. That column is filled in
 * by the customer's browser at upload time, which means it holds whatever the
 * browser sent -- and this value is handed to the render engine as "fetch this
 * image". Trusting it let a customer point our render pipeline at any URL on
 * the internet: somebody else's image, a tracking endpoint, an address the
 * vendor's servers can reach and the public cannot. The path is checked to be
 * inside the business's own folder and the URL is rebuilt from it, so the only
 * thing this can ever return is an object in our own bucket.
 */
export async function getSourceImageUrl(
  supabase: SupabaseClient,
  businessId: string,
): Promise<string | null> {
  // A few rows rather than one: if the newest row is malformed, the business
  // should still render from its most recent GOOD upload, not from nothing.
  const { data } = await supabase
    .from("media_assets")
    .select("storage_path")
    .eq("business_id", businessId)
    .eq("kind", "image")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const row of data ?? []) {
    const path = ownedStoragePath(businessId, row.storage_path as string | null);
    if (!path) continue;
    return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  return null;
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
  /** The exact model slug, for the AI Act record. "fal" is not an answer. */
  model?: string,
  /** The brief this came from; hashed and excerpted by the generation log. */
  prompt?: string,
): Promise<void> {
  const cost = engine && kind ? renderCostUsdMinor(engine, kind) : null;

  const { data } = await supabase
    .from("creatives")
    .insert({
      business_id: businessId,
      concept_id: conceptId,
      state: "ready",
      media_url: mediaUrl,
      ...(engine ? { engine } : {}),
      ...(cost !== null ? { render_cost_usd_minor: cost } : {}),
    })
    .select("id")
    .single();

  // The AI Act record. Written here rather than inside each engine because
  // this is the one point every finished render passes through, whichever
  // engine made it -- an engine added later is logged without remembering to.
  //
  // Never awaited into the caller's failure path: a creative that exists but is
  // unlogged is a gap in evidence, one that failed because the log was down is
  // a broken product. recordGeneration swallows its own errors and reports them.
  if (engine) {
    await recordGeneration(supabase, {
      businessId,
      creativeId: (data?.id as string | undefined) ?? null,
      provider: engine,
      model: model ?? engine,
      kind: kind === "video" ? "video" : "image",
      input: prompt ?? null,
      outputRef: mediaUrl,
      costUsdMinor: cost,
    });
  }
}
