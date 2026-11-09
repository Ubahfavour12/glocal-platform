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
import { asAdLanguage } from "@/lib/copy/language";
import { usageMeter } from "@/lib/ai/usage";

export function livePipelineDeps(supabase: SupabaseClient): PipelineDeps {
  return {
    async getBusiness(businessId) {
      const { data } = await supabase
        .from("businesses")
        .select("name, category, goal, strategy_profile, founded_year, ad_language")
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
        foundedYear: (data.founded_year as number | null) ?? null,
        adLanguage: asAdLanguage(data.ad_language as string | null),
      } as ProductBrief;
    },

    async countConcepts(businessId, language) {
      const { count } = await supabase
        .from("concepts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("language", language);
      return count ?? 0;
    },

    async listExistingHooks(businessId, language) {
      // Same language only. Telling a model writing Pidgin to avoid fifty
      // English hooks spends prompt on nothing: it is not at risk of
      // repeating them, and the hooks it IS at risk of repeating would not
      // be in the list.
      const { data } = await supabase
        .from("concepts")
        .select("hook")
        .eq("business_id", businessId)
        .eq("language", language)
        .order("rank", { ascending: true })
        .limit(50);
      return (data ?? []).map((r) => r.hook as string);
    },

    async scrape(keywords) {
      const apiKey = process.env.YOUTUBE_DATA_API_KEY;
      if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY not configured");
      return scrapeNiche(apiKey, { keywords, competitorHandles: [] });
    },

    async generate(businessId, brief, viral, count, avoidHooks) {
      // One meter per call, built here rather than held on the deps object:
      // the deps are constructed once and could serve several businesses, and
      // a meter that outlived its business would charge the wrong account.
      const meter = usageMeter(supabase, businessId, "concepts");
      try {
        return await generateConcepts(brief, viral, count, "", avoidHooks, meter.sink);
      } finally {
        // In the `finally` so a failed generation still records the tokens it
        // burned. A call that returned unparseable JSON was billed in full.
        await meter.flush();
      }
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
