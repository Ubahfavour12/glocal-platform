/**
 * Live render adapter — binds the render lane (render.ts) to fal.ai, the media
 * store, and the subscription quota. Exposes the `renderCreative` function the
 * nightly orchestrator expects. Entirely dormant until FAL_KEY is set AND the
 * business has a stored source image; in every not-ready case it returns an
 * empty mediaUrl so the launcher simply makes a link ad without a custom
 * creative (still valid).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { falConfigFromEnv, pollRender, submitRender } from "@/lib/fal/client";
import {
  countRendersToday,
  getSourceImageUrl,
  persistRenderedCreative,
} from "@/lib/media/storage";
import { promptFromConcept, renderConcepts, type RenderDeps } from "./render";
import { asPlan, planAllowsRender, type PlanState } from "@/lib/billing/plan";

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
      cfg = falConfigFromEnv();
    } catch {
      return empty; // no key -> lane dormant
    }

    const sourceImageUrl = await getSourceImageUrl(supabase, businessId);
    if (!sourceImageUrl) return empty; // no product photo stored yet

    // Freemium gate: free tier gets exactly one render, then it's blocked until
    // they upgrade. Paid is capped by the tier's daily quota.
    const { data: biz } = await supabase
      .from("businesses")
      .select("plan, free_render_used")
      .eq("id", businessId)
      .maybeSingle();
    const planState: PlanState = {
      plan: asPlan(biz?.plan as string | null),
      freeRenderUsed: Boolean(biz?.free_render_used),
    };
    if (!planAllowsRender(planState)) return empty; // free preview used up -> paywall

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
        // "image" matches the kind submitted below; fal routes status by model.
        const s = await pollRender(cfg, jobId, "image");
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
    // Spend the free tier's one render once it actually lands.
    if (rendered && planState.plan === "free" && !planState.freeRenderUsed) {
      await supabase.from("businesses").update({ free_render_used: true }).eq("id", businessId);
    }
    return rendered ? { conceptId: concept.id, mediaUrl: rendered.mediaUrl, copy: concept.copy } : empty;
  };
}
