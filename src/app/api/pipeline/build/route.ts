import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildPipelineBatch } from "@/lib/research/pipeline";
import { livePipelineDeps } from "@/lib/research/pipeline-live";
import { runForBusiness, type BizRow } from "@/lib/orchestrator/run-business";

export const maxDuration = 300;

/**
 * Phase 2.1, the agent comes alive after signup. Fired (fire-and-forget) by
 * onboarding: researches the niche and writes the first concept batch for the
 * signed-in user's business. The nightly cron tops the pool up to the target.
 * Idempotent: a full pipeline short-circuits, so repeat calls are harmless.
 *
 * It then builds the customer's FIRST plan immediately, rather than leaving
 * them staring at an empty dashboard until the 20:30 cron. This is the moment a
 * new user decides whether the product is real, so it includes the render: a
 * free account's single image is worth far more here than at bedtime. Only ever
 * runs when no plan exists yet, so it cannot burn a second render.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  // Ownership via the user-scoped client (RLS), work via the service client.
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "finish onboarding first" }, { status: 404 });
  }

  const service = createServiceClient();
  const result = await buildPipelineBatch(livePipelineDeps(service), business.id);
  if (result.status === "error") {
    return NextResponse.json(result, { status: 500 });
  }

  const firstPlan = await buildFirstPlanIfNone(service, business.id);
  return NextResponse.json({ ...result, firstPlan });
}

type Supa = ReturnType<typeof createServiceClient>;

/**
 * Build the very first plan so the new customer sees real ads (and their one
 * free render) within a minute of finishing onboarding. Best-effort: a failure
 * here must never fail onboarding, because the nightly run will cover it.
 */
async function buildFirstPlanIfNone(supabase: Supa, businessId: string): Promise<string> {
  try {
    const { count } = await supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId);
    if ((count ?? 0) > 0) return "skipped_existing";

    const { data: biz } = await supabase
      .from("businesses")
      .select("id, name, category, goal, persona, full_auto, daily_budget_usd_minor, category_blocked")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz || biz.category_blocked) return "skipped";

    // skipSideEffects: the pipeline was just built above and organic posting is
    // not relevant on day zero. Rendering stays ON — it is the whole point.
    const plan = await runForBusiness(supabase, biz as BizRow, new Date(), {
      skipSideEffects: true,
    });
    return plan.status;
  } catch {
    return "deferred_to_nightly";
  }
}
