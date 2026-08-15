import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { launchPlan, type LaunchContext, type PlanAd } from "@/lib/orchestrator/launcher";
import { liveLaunchAdapters } from "@/lib/orchestrator/launcher-live";
import { metaConfigFromEnv, objectiveForGoal, ctaForGoal } from "@/lib/meta/client";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import type { ConnectionMode } from "@/lib/tracking/modes";
import { asPlan, planAllowsLaunch } from "@/lib/billing/plan";

export const maxDuration = 300;

/**
 * Morning launcher cron, Phase 2.2. CRON_SECRET auth, runs after the evening
 * approvals. For every APPROVED, not-yet-launched plan it builds the real Meta
 * ad objects (all PAUSED) and mints each ad's smart link. Businesses without a
 * provisioned Meta child account are skipped as "awaiting_provisioning"
 * (provisioning is a dogfood-time step); Meta's no-payment-method block is
 * recorded as awaiting_payment. Never enables anything.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Due now = approved, not yet launched, and either scheduled for a moment
  // that has passed, or unscheduled (which means the default morning run).
  const nowIso = new Date().toISOString();
  const { data: plans, error } = await supabase
    .from("approvals")
    .select("id, business_id, plan_date, payload, scheduled_for")
    .eq("status", "approved")
    .is("launched_at", null)
    .lte("plan_date", today)
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const outcomes: { businessId: string; result: string }[] = [];
  let cfg: ReturnType<typeof metaConfigFromEnv> | null = null;
  try {
    cfg = metaConfigFromEnv();
  } catch {
    return NextResponse.json({ error: "meta not configured" }, { status: 500 });
  }

  for (const plan of plans ?? []) {
    try {
      const outcome = await launchForPlan(supabase, plan, cfg);
      outcomes.push({ businessId: plan.business_id, result: outcome });
    } catch (e) {
      outcomes.push({ businessId: plan.business_id, result: `error: ${(e as Error).message}` });
    }
  }
  return NextResponse.json({ launched: outcomes.length, outcomes });
}

type Supa = ReturnType<typeof createServiceClient>;

async function launchForPlan(
  supabase: Supa,
  plan: { id: string; business_id: string; plan_date: string; payload: ApprovalPlanPayload },
  cfg: ReturnType<typeof metaConfigFromEnv>,
): Promise<string> {
  const businessId = plan.business_id;

  const { data: biz } = await supabase
    .from("businesses")
    .select("goal, connection_mode, destination, service_geo, plan")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz) return "business_missing";

  // Paywall: launching live ads is paid-only (the free tier is preview-render
  // only). Free/expired plans are recorded and skipped — never launched.
  if (!planAllowsLaunch({ plan: asPlan(biz.plan as string | null), freeRenderUsed: true })) {
    await supabase.from("journal_entries").insert({
      business_id: businessId,
      entry_type: "note",
      content: { action: "launch_skipped", reason: "awaiting_upgrade" },
    });
    return "awaiting_upgrade";
  }

  // Requires a provisioned Meta child account + page + campaign. Absent
  // pre-dogfooding: record and skip, do not fail the run.
  const { data: acct } = await supabase
    .from("ad_accounts")
    .select("platform_account_id, platform_page_id")
    .eq("business_id", businessId)
    .eq("platform", "meta")
    .maybeSingle();
  if (!acct?.platform_account_id || !acct.platform_page_id) {
    await supabase.from("journal_entries").insert({
      business_id: businessId,
      entry_type: "note",
      content: { action: "launch_skipped", reason: "awaiting_provisioning" },
    });
    return "awaiting_provisioning";
  }

  const { data: camp } = await supabase
    .from("campaigns")
    .select("platform_campaign_id")
    .eq("business_id", businessId)
    .eq("platform", "meta")
    .maybeSingle();
  const campaignId = camp?.platform_campaign_id;
  if (!campaignId) return "awaiting_campaign";

  const goal = (biz.goal ?? "whatsapp") as "sales" | "leads" | "whatsapp" | "visits";
  const countries = extractCountries(biz.service_geo);

  const ctx: LaunchContext = {
    businessId,
    planDate: plan.plan_date,
    adAccountId: acct.platform_account_id,
    pageId: acct.platform_page_id,
    campaignId,
    countries,
  };

  const ads = payloadToAds(plan.payload, goal);
  const adapters = liveLaunchAdapters(
    supabase,
    {
      connectionMode: (biz.connection_mode ?? "whatsapp") as ConnectionMode,
      destination: biz.destination ?? "",
    },
    cfg,
  );

  const summary = await launchPlan(ctx, ads, adapters);
  await supabase.from("approvals").update({ launched_at: new Date().toISOString() }).eq("id", plan.id);
  void objectiveForGoal; // objective resolved at provisioning time
  return `launched ${summary.launched}, awaiting_payment ${summary.awaitingPayment}, errors ${summary.errors}`;
}

function payloadToAds(payload: ApprovalPlanPayload, goal: Parameters<typeof ctaForGoal>[0]): PlanAd[] {
  const cta = ctaForGoal(goal);
  return payload.challengers.map((c) => ({
    role: "challenger" as const,
    conceptId: c.conceptId,
    hook: c.hook,
    copy: c.copy,
    cta,
    budgetUsdMinor: c.budgetUsdMinor,
    mediaUrl: c.mediaUrl,
  }));
}

function extractCountries(serviceGeo: unknown): string[] {
  if (serviceGeo && typeof serviceGeo === "object" && "countries" in serviceGeo) {
    const c = (serviceGeo as { countries?: unknown }).countries;
    if (Array.isArray(c) && c.every((x) => typeof x === "string")) return c as string[];
  }
  return ["NG"];
}
