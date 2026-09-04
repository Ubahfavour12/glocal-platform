/**
 * Live render adapter — binds the render lane (render.ts) to fal.ai, the media
 * store, and the subscription quota. Exposes the `renderCreative` function the
 * nightly orchestrator expects. Entirely dormant until FAL_KEY is set AND the
 * business has a stored source image; in every not-ready case it returns an
 * empty mediaUrl so the launcher simply makes a link ad without a custom
 * creative (still valid).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  availableEngines,
  falEngine,
  higgsfieldEngine,
  submitWithFailover,
  type EngineName,
  type RenderEngine,
} from "./engine";
import {
  countRendersToday,
  getSourceImageUrl,
  persistRenderedCreative,
} from "@/lib/media/storage";
import { promptFromConcept, renderConcepts, type RenderDeps } from "./render";
import { routeRender } from "./router";
import { canRenderKind, type RenderKind } from "./quota";
import { asPlan, planAllowsRender, type PlanState } from "@/lib/billing/plan";

interface OrchestratorConcept {
  id: string;
  hook: string;
  copy: string;
  /** What this concept is meant to become; absent means an image. */
  kind?: string | null;
}
interface RenderedForPlan {
  conceptId: string;
  mediaUrl: string;
  copy: string;
}

export function renderCreativeLive(supabase: SupabaseClient) {
  return async (businessId: string, concept: OrchestratorConcept): Promise<RenderedForPlan> => {
    const empty: RenderedForPlan = { conceptId: concept.id, mediaUrl: "", copy: concept.copy };

    // fal primary, Higgsfield standby. Empty when neither is configured, which
    // leaves the lane dormant instead of throwing.
    const engines = availableEngines(falEngine(), higgsfieldEngine());
    if (engines.length === 0) return empty;

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

    // What this concept is meant to become. The first render on an account is
    // always an image, and a video only runs when the weighted allowance can
    // actually cover it, so nobody picks video and watches it fail.
    const wantedKind: RenderKind = (concept.kind as RenderKind) === "video" ? "video" : "image";
    const kind: RenderKind = canRenderKind({ usedToday, dailyLimit }, wantedKind)
      ? wantedKind
      : "image";

    // Both engines are live and the job picks between them: video to Higgsfield
    // for its motion work, images to fal where they are cheapest, and a free
    // account never reaches the expensive engine whatever it asked for.
    const route = routeRender({ kind, plan: planState.plan, available: engines });
    const ordered: RenderEngine[] = route.order.length > 0 ? route.order : engines;

    // Whichever engine accepted the job has to be the one polled: job ids are
    // not portable between vendors.
    let usedEngine: RenderEngine = ordered[0];
    const failedEngines: { engine: EngineName; error: string }[] = [];

    const deps: RenderDeps = {
      submit: async (input) => {
        const result = await submitWithFailover(ordered, input);
        if (!result) throw new Error("no render engine could be reached");
        usedEngine = ordered.find((e) => e.name === result.engine) ?? ordered[0];
        failedEngines.push(...result.failed);
        return { jobId: result.status.jobId };
      },
      poll: async (jobId) => {
        const s = await usedEngine.poll(jobId, kind);
        return { state: s.state, mediaUrl: s.mediaUrl, error: s.error };
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      // Record which engine made it. The duel already decides which creative
      // wins on real money, so tagging the maker turns those verdicts into
      // engine evidence without running a single extra experiment.
      persist: (conceptId, mediaUrl) =>
        persistRenderedCreative(supabase, businessId, conceptId, mediaUrl, usedEngine.name, kind),
    };

    const summary = await renderConcepts(
      [{ conceptId: concept.id, prompt: promptFromConcept(concept.hook, []) }],
      // Entry tier is image-led (cheaper); vertical for reels/stories.
      { sourceImageUrl, kind, placement: "reel", quota: { usedToday, dailyLimit } },
      deps,
    );

    // Record a failover so a silent vendor outage is visible in the journal
    // rather than only showing up as a slow night.
    if (failedEngines.length > 0) {
      await supabase.from("journal_entries").insert({
        business_id: businessId,
        entry_type: "note",
        content: {
          action: "render_failover",
          detail: { used: usedEngine.name, failed: failedEngines, routing: route.reason },
        },
      });
    }

    const rendered = summary.rendered[0];
    // Spend the free tier's one render once it actually lands.
    if (rendered && planState.plan === "free" && !planState.freeRenderUsed) {
      await supabase.from("businesses").update({ free_render_used: true }).eq("id", businessId);
    }
    return rendered ? { conceptId: concept.id, mediaUrl: rendered.mediaUrl, copy: concept.copy } : empty;
  };
}
