/**
 * Run one business's plan. Extracted from the nightly cron so the same code
 * path serves both the scheduled run and the customer pressing "Regenerate".
 *
 * `skipRender` exists for the on-demand path: re-rendering creative is by far
 * the most expensive part of a plan, and a customer who dislikes the *words*
 * should not trigger a fresh paid render every time they tap. The nightly run
 * renders normally.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { runNightly, type BusinessContext, type NightlyPlan } from "@/lib/orchestrator/nightly";
import { buildLiveAdapters, type LiveDeps } from "@/lib/orchestrator/live-adapters";
import { fetchAdInsights, type AdDayMetrics } from "@/lib/meta/insights";
import { metaConfigFromEnv } from "@/lib/meta/client";
import { llmGatewayScan } from "@/lib/compliance/llm";
import { buildPipelineBatch } from "@/lib/research/pipeline";
import { livePipelineDeps } from "@/lib/research/pipeline-live";
import { renderCreativeLive } from "@/lib/creative/render-live";
import { scheduleOrganicForBusiness } from "@/lib/organic/posting-live";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import type { PersonaMode } from "@/lib/guardrails/budget";

type Supa = ReturnType<typeof createServiceClient>;

export interface BizRow {
  id: string;
  name: string;
  category: string;
  goal: BusinessContext["goal"];
  persona: PersonaMode;
  full_auto: boolean;
  daily_budget_usd_minor: number;
}

export interface RunOptions {
  /** Skip paid creative rendering (on-demand regenerate). */
  skipRender?: boolean;
  /** Skip topping up the concept pool and organic scheduling (faster path). */
  skipSideEffects?: boolean;
  /** Concept ids to put at the front of the queue (customer hand-picked). */
  preferConceptIds?: string[];
  /**
   * Concept ids to skip. Without this, "Regenerate" hands back the identical
   * plan: the picker is deterministic (top-ranked unrendered concepts, in rank
   * order), so rejecting ads the customer disliked is the only way a rebuild
   * produces anything new.
   */
  excludeConceptIds?: string[];
}

// Either engine being configured is enough; the render lane fails over between
// them (see lib/creative/engine.ts).
const renderConfigured = () =>
  Boolean(
    process.env.FAL_KEY ||
      process.env.FAL_API_KEY ||
      process.env.HIGGSFIELD_CREDENTIALS ||
      (process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET),
  );

export async function runForBusiness(
  supabase: Supa,
  biz: BizRow,
  now: Date,
  opts: RunOptions = {},
): Promise<NightlyPlan> {
  // Keep the concept pipeline topped up toward the target. Short-circuits when
  // full; research failures degrade inside the builder and must never break the
  // plan.
  if (!opts.skipSideEffects) {
    try {
      await buildPipelineBatch(livePipelineDeps(supabase), biz.id);
    } catch {
      /* plan continues on the existing pool */
    }
  }

  const [{ data: wallet }, { data: store }, { data: champAd }] = await Promise.all([
    supabase
      .from("wallet_balances")
      .select("balance_usd_minor")
      .eq("business_id", biz.id)
      .maybeSingle(),
    supabase.from("store_connections").select("id").eq("business_id", biz.id).maybeSingle(),
    supabase
      .from("ads")
      .select("budget_usd_minor, campaigns!inner(business_id)")
      .eq("campaigns.business_id", biz.id)
      .eq("is_champion", true)
      .maybeSingle(),
  ]);

  const deps = liveDepsFor(supabase, biz.id, now);
  const live = buildLiveAdapters(deps, now);
  const gate = await live.revenueGate(biz.id);

  const ctx: BusinessContext = {
    businessId: biz.id,
    name: biz.name,
    category: biz.category,
    goal: biz.goal,
    persona: biz.persona,
    fullAuto: biz.full_auto,
    dailyBudgetUsdMinor: biz.daily_budget_usd_minor,
    currentChampionBudgetUsdMinor: champAd?.budget_usd_minor ?? null,
    storeConnected: !!store,
    revenueTrusted: gate.allowed,
    walletBalanceUsdMinor: wallet?.balance_usd_minor ?? 0,
    countries: [],
  };

  const plan = await runNightly(
    ctx,
    {
      getOpenTestCandidates: live.getOpenTestCandidates,
      getChampionState: live.getChampionState,
      getNextConcepts: async (businessId, count) => {
        const { data } = await supabase
          .from("concepts")
          .select("id, rank, hook, copy_angle, cta")
          .eq("business_id", businessId)
          .eq("rendered", false)
          .order("rank", { ascending: true })
          // Over-fetch: rejected concepts are filtered out below, and hand-picks
          // may sit far down the ranking.
          .limit(
            count +
              (opts.preferConceptIds?.length ?? 0) +
              (opts.excludeConceptIds?.length ?? 0),
          );
        const excluded = new Set(opts.excludeConceptIds ?? []);
        const rows = (data ?? [])
          .filter((c) => !excluded.has(c.id))
          .map((c) => ({
            id: c.id,
            rank: c.rank,
            hook: c.hook,
            copy: c.copy_angle,
            cta: c.cta,
          }));
        // Customer hand-picks jump the queue, in the order they chose them.
        const preferred = opts.preferConceptIds ?? [];
        if (preferred.length === 0) return rows.slice(0, count);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const front = preferred.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
        const rest = rows.filter((r) => !preferred.includes(r.id));
        return [...front, ...rest].slice(0, count);
      },
      llmGatewayScan: process.env.ANTHROPIC_API_KEY ? llmGatewayScan : undefined,
      renderCreative:
        !opts.skipRender && renderConfigured() ? renderCreativeLive(supabase) : undefined,
      savePlan: async (p) => {
        const payload: ApprovalPlanPayload = {
          planDate: p.planDate,
          currency: "USD",
          championBudgetUsdMinor: p.championBudgetUsdMinor,
          persona: biz.persona,
          challengers: p.challengers.map((c) => ({
            conceptId: c.concept.id,
            hook: c.concept.hook,
            copy: c.concept.copy,
            budgetUsdMinor: c.budgetUsdMinor,
            mediaUrl: c.creative?.mediaUrl,
          })),
          commentary: p.commentary,
          scoreboard: {
            metricUsed: p.verdict?.status === "decided" ? p.verdict.metricUsed : undefined,
            note: p.commentary[0] ?? "Tomorrow's plan is ready.",
          },
        };
        await supabase.from("approvals").upsert(
          {
            business_id: p.businessId,
            plan_date: p.planDate,
            payload,
            status: p.status === "auto_approved" ? "approved" : "awaiting",
          },
          { onConflict: "business_id,plan_date" },
        );
      },
      audit: async (businessId, action, detail) => {
        await supabase.from("journal_entries").insert({
          business_id: businessId,
          entry_type: "note",
          content: { action, detail },
        });
      },
    },
    now,
  );

  // Organic posting lane: a calm daily post from the plan's content. Dormant
  // unless a connected brand exists; failure here never affects the ad plan.
  if (!opts.skipSideEffects) {
    try {
      const candidates = plan.challengers.map((c) => ({
        conceptId: c.concept.id,
        text: c.concept.copy,
        mediaUrls: c.creative?.mediaUrl ? [c.creative.mediaUrl] : [],
      }));
      if (candidates.length > 0) {
        await scheduleOrganicForBusiness(supabase, biz.id, candidates, now);
      }
    } catch {
      /* organic is best-effort */
    }
  }

  return plan;
}

export function liveDepsFor(supabase: Supa, businessId: string, now: Date): LiveDeps {
  const insightsCache = new Map<string, Promise<AdDayMetrics[]>>();

  return {
    async fetchInsights(sinceIso, untilIso) {
      const key = `${sinceIso}|${untilIso}`;
      if (!insightsCache.has(key)) {
        insightsCache.set(
          key,
          (async () => {
            const { data: acct } = await supabase
              .from("ad_accounts")
              .select("platform_account_id, quarantined")
              .eq("business_id", businessId)
              .eq("platform", "meta")
              .maybeSingle();
            if (!acct?.platform_account_id || acct.quarantined) return [];
            try {
              return await fetchAdInsights(
                metaConfigFromEnv(),
                acct.platform_account_id,
                sinceIso,
                untilIso,
              );
            } catch {
              return []; // Meta unreachable/unconfigured -> degrade, don't crash
            }
          })(),
        );
      }
      return insightsCache.get(key)!;
    },

    async listOpenTestAds(bizId) {
      const { data: test } = await supabase
        .from("ab_tests")
        .select("champion_ad_id, challenger_ad_ids")
        .eq("business_id", bizId)
        .eq("status", "pending")
        .order("test_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!test) return [];
      const ids = [test.champion_ad_id, ...(test.challenger_ad_ids ?? [])].filter(Boolean);
      if (ids.length < 2) return [];
      const { data: ads } = await supabase
        .from("ads")
        .select("id, platform_ad_id, created_at")
        .in("id", ids as string[]);
      return (ads ?? [])
        .filter((a) => a.platform_ad_id)
        .map((a) => ({
          adId: a.id,
          platformAdId: a.platform_ad_id as string,
          startedAt: new Date(a.created_at),
        }));
    },

    async listAttributedRevenue(bizId, sinceIso) {
      const { data: convs } = await supabase
        .from("conversions")
        .select("ad_code, value_usd_minor, created_at")
        .eq("business_id", bizId)
        .not("ad_code", "is", null)
        .gte("created_at", sinceIso);
      if (!convs?.length) return [];
      const codes = [...new Set(convs.map((c) => c.ad_code as string))];
      const { data: links } = await supabase
        .from("smart_links")
        .select("code, ad_id")
        .in("code", codes);
      const adIdByCode = new Map((links ?? []).map((l) => [l.code, l.ad_id]));
      const adIds = [...new Set([...adIdByCode.values()].filter(Boolean))];
      const { data: ads } = await supabase
        .from("ads")
        .select("id, platform_ad_id")
        .in("id", adIds as string[]);
      const platformByAdId = new Map((ads ?? []).map((a) => [a.id, a.platform_ad_id]));

      const out = [];
      for (const c of convs) {
        const adId = adIdByCode.get(c.ad_code as string);
        const platformAdId = adId ? platformByAdId.get(adId) : null;
        if (!platformAdId) continue;
        out.push({
          platformAdId,
          dateIso: (c.created_at as string).slice(0, 10),
          revenueUsdMinor: Number(c.value_usd_minor ?? 0),
        });
      }
      return out;
    },

    async listAttributedOrderTimes(bizId, sinceIso) {
      const { data } = await supabase
        .from("conversions")
        .select("created_at")
        .eq("business_id", bizId)
        .not("ad_code", "is", null)
        .gte("created_at", sinceIso);
      return (data ?? []).map((r) => new Date(r.created_at as string));
    },

    async getChampion(bizId) {
      const { data: ad } = await supabase
        .from("ads")
        .select("platform_ad_id, created_at, campaigns!inner(business_id)")
        .eq("campaigns.business_id", bizId)
        .eq("is_champion", true)
        .maybeSingle();
      if (!ad?.platform_ad_id) return null;
      const { data: verdict } = await supabase
        .from("verdicts")
        .select("decided_at, ab_tests!inner(business_id)")
        .eq("ab_tests.business_id", bizId)
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      void now;
      return {
        platformAdId: ad.platform_ad_id as string,
        since: new Date((verdict?.decided_at as string) ?? (ad.created_at as string)),
      };
    },
  };
}
