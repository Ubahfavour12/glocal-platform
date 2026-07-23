/**
 * Live render adapter — binds the render lane (render.ts) to Higgsfield, the
 * media store, and the subscription quota. Exposes the `renderCreative`
 * function the nightly orchestrator expects. Entirely dormant until
 * HIGGSFIELD_API_KEY is set AND the business has a stored source image; in
 * every not-ready case it returns an empty mediaUrl so the launcher simply
 * makes a link ad without a custom creative (still valid).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  higgsfieldConfigFromEnv,
  pollRender,
  submitRender,
} from "@/lib/higgsfield/client";
import {
  countRendersToday,
  getSourceImageUrl,
  persistRenderedCreative,
} from "@/lib/media/storage";
import { promptFromConcept, renderConcepts, type RenderDeps } from "./render";

interface OrchestratorConcept {
  id: string;
  hook: string;
  copy: string;
}
interface RenderedForPlan {
  conceptId: string;
  mediaUrl: string;
  copy: string;
}

export function renderCreativeLive(supabase: SupabaseClient) {
  return async (businessId: string, concept: OrchestratorConcept): Promise<RenderedForPlan> => {
    const empty: RenderedForPlan = { conceptId: concept.id, mediaUrl: "", copy: concept.copy };

    let cfg;
    try {
      cfg = higgsfieldConfigFromEnv();
    } catch {
      return empty; // no key -> lane dormant
    }

    const sourceImageUrl = await getSourceImageUrl(supabase, businessId);
    if (!sourceImageUrl) return empty; // no product photo stored yet

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("renders_per_day")
      .eq("business_id", businessId)
      .maybeSingle();
    const dailyLimit = (sub?.renders_per_day as number) ?? 2;
    const usedToday = await countRendersToday(supabase, businessId);

    const deps: RenderDeps = {
      submit: async (input) => ({ jobId: (await submitRender(cfg, input)).jobId }),
      poll: async (jobId) => {
        const s = await pollRender(cfg, jobId);
        return { state: s.state, mediaUrl: s.mediaUrl, error: s.error };
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      persist: (conceptId, mediaUrl) =>
        persistRenderedCreative(supabase, businessId, conceptId, mediaUrl),
    };

    const summary = await renderConcepts(
      [{ conceptId: concept.id, prompt: promptFromConcept(concept.hook, []) }],
      // Entry tier is image-led (cheaper); vertical for reels/stories.
      { sourceImageUrl, kind: "image", placement: "reel", quota: { usedToday, dailyLimit } },
      deps,
    );

    const rendered = summary.rendered[0];
    return rendered ? { conceptId: concept.id, mediaUrl: rendered.mediaUrl, copy: concept.copy } : empty;
  };
}
