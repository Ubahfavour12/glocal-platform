/**
 * Live PipelineDeps — binds the pipeline builder to Supabase, the YouTube
 * scraper, and the concept engine. Used by /api/pipeline/build (post-
 * onboarding) and the nightly cron (top-ups until the target).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeNiche } from "./youtube";
import { generateConcepts, type ProductBrief } from "./concepts";
import type { PipelineDeps } from "./pipeline";
import { buildStrategyContext } from "@/lib/studio/profile";
import type { StudioAnswers } from "@/lib/studio/questions";

export function livePipelineDeps(supabase: SupabaseClient): PipelineDeps {
  return {
    async getBusiness(businessId) {
      const { data } = await supabase
        .from("businesses")
        .select("name, category, goal, strategy_profile")
        .eq("id", businessId)
        .maybeSingle();
      if (!data) return null;
      // The Strategy Studio deep brief (if filled) becomes the concept prompt's
      // notes, so the agent writes sharper, more specific ads.
      const strategy = buildStrategyContext(data.strategy_profile as StudioAnswers | null);
      return {
        businessName: data.name,
        category: data.category,
        goal: data.goal,
        description: strategy || undefined,
      } as ProductBrief;
    },

    async countConcepts(businessId) {
      const { count } = await supabase
        .from("concepts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId);
      return count ?? 0;
    },

    async listExistingHooks(businessId) {
      const { data } = await supabase
        .from("concepts")
        .select("hook")
        .eq("business_id", businessId)
        .order("rank", { ascending: true })
        .limit(50);
      return (data ?? []).map((r) => r.hook as string);
    },

    async scrape(keywords) {
      const apiKey = process.env.YOUTUBE_DATA_API_KEY;
      if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY not configured");
      return scrapeNiche(apiKey, { keywords, competitorHandles: [] });
    },

    async generate(brief, viral, count, avoidHooks) {
      return generateConcepts(brief, viral, count, "", avoidHooks);
    },

    async insertConcepts(rows) {
      const { error } = await supabase.from("concepts").insert(rows);
      if (error) throw new Error(error.message);
    },

    async audit(businessId, action, detail) {
      await supabase.from("journal_entries").insert({
        business_id: businessId,
        entry_type: "note",
        content: { action, detail },
      });
    },
  };
}
