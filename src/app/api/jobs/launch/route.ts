import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { launchPlan, type LaunchContext, type PlanAd } from "@/lib/orchestrator/launcher";
import { DEFAULT_LAUNCH_HOUR, launchDueNow } from "@/lib/orchestrator/launch-timing";
import { liveLaunchAdapters } from "@/lib/orchestrator/launcher-live";
import { metaConfigFromEnv, objectiveForGoal, ctaForGoal } from "@/lib/meta/client";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import type { ConnectionMode } from "@/lib/tracking/modes";
import { asPlan, planAllowsLaunch } from "@/lib/billing/plan";
import { resolveTargetCountries } from "@/lib/tracking/geo";
import { audienceConstraintsFor } from "@/lib/compliance/targeting";
import { markupBpsOrDefault } from "@/lib/billing/spend";
import { holdAmountUsdMinor } from "@/lib/money/hold";
import { totalPlannedUsdMinor } from "@/lib/orchestrator/plan-payload";

/** How long an approved-but-unlaunched plan stays launchable: today + yesterday. */
const PLAN_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

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

  /**
   * A plan is written for one specific day. Its budgets, its concepts and the
   * verdict behind it are all that day's, so launching it later is not "late",
   * it is wrong. Without this, an approved plan that never launched sits in the
   * queue forever and goes live the moment the ad platform is connected, taking
   * every other stale plan with it. Yesterday is allowed so a cron that runs
   * late, or a timezone edge, does not silently drop a real plan.
   */
  const cutoff = new Date(Date.now() - PLAN_STALE_AFTER_MS).toISOString().slice(0, 10);

  // Anything older has missed its day. Retire it so it stops being a queue of
  // ads waiting to fire, and so Activity shows what happened to it.
  const { data: staleRows } = await supabase
    .from("approvals")
    .update({ status: "expired" })
    .eq("status", "approved")
    .is("launched_at", null)
    .lt("plan_date", cutoff)
    .select("id");
  const expired = staleRows?.length ?? 0;

  // Due now = approved, not yet launched, for a day that has not passed, and
  // either scheduled for a moment that has passed or unscheduled (which means
  // the default morning run).
  const nowIso = new Date().toISOString();
  const { data: plans, error } = await supabase
    .from("approvals")
    .select("id, business_id, plan_date, payload, scheduled_for, businesses(launch_hour, launch_timezone)")
    .eq("status", "approved")
    .is("launched_at", null)
    .lte("plan_date", today)
    .gte("plan_date", cutoff)
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /**
   * A plan with an explicit scheduled_for was timed by hand for that one night
   * and the query above already filtered on it. Everything else follows the
   * business's own daily launch hour, which is the single preference both
   * modes read: it pre-fills the approval card, and for a full-auto account it
   * IS the launch time. Skipping is not failing, the next run picks it up.
   */
  const due = (plans ?? []).filter((p) => {
    if (p.scheduled_for) return true;
    const biz = p.businesses as unknown as
      | { launch_hour?: number; launch_timezone?: string }
      | null;
    return launchDueNow(
      new Date(),
      biz?.launch_hour ?? DEFAULT_LAUNCH_HOUR,
      biz?.launch_timezone ?? "Africa/Lagos",
    );
  });

  /**
   * Yesterday's promise is returned before today's is made. A hold belongs to
   * one day; leaving it in place past that day would keep money out of the
   * customer's balance that nobody ever spent.
   */
  const { data: releasedUsdMinor } = await supabase.rpc("release_stale_budget_holds", {
    p_before_date: today,
  });

  const outcomes: { businessId: string; result: string }[] = [];
  let cfg: ReturnType<typeof metaConfigFromEnv> | null = null;
  try {
    cfg = metaConfigFromEnv();
  } catch {
    return NextResponse.json({ error: "meta not configured" }, { status: 500 });
  }

  for (const plan of due) {
    try {
      const outcome = await launchForPlan(supabase, plan, cfg);
      outcomes.push({ businessId: plan.business_id, result: outcome });
    } catch (e) {
      outcomes.push({ businessId: plan.business_id, result: `error: ${(e as Error).message}` });
    }
  }
  return NextResponse.json({
    launched: outcomes.length,
    expired,
    waiting: (plans ?? []).length - due.length,
    released_usd_minor: Number(releasedUsdMinor ?? 0),
    outcomes,
  });
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
    .select("goal, category, connection_mode, destination, service_geo, country, plan")
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
  const targetCountries = resolveTargetCountries(biz.service_geo, biz.country as string | null);

  // Restricted categories (alcohol, dating) carry network-mandated audience
  // rules. The gateway has always flagged this; now it is actually applied.
  const constraints = audienceConstraintsFor((biz.category as string) ?? "", targetCountries);
  if (constraints.countries.length === 0) {
    await supabase.from("journal_entries").insert({
      business_id: businessId,
      entry_type: "note",
      content: {
        action: "launch_skipped",
        reason: "category_not_advertisable_in_target_markets",
        detail: { blocked: constraints.blockedCountries },
      },
    });
    return "category_blocked_in_market";
  }
  if (constraints.note) {
    await supabase.from("journal_entries").insert({
      business_id: businessId,
      entry_type: "note",
      content: { action: "targeting_constrained", detail: { note: constraints.note } },
    });
  }
  const countries = constraints.countries;

  const ctx: LaunchContext = {
    businessId,
    planDate: plan.plan_date,
    adAccountId: acct.platform_account_id,
    pageId: acct.platform_page_id,
    campaignId,
    countries,
    ageMin: constraints.ageMin,
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

  /**
   * The day's budget leaves the spendable balance now, not when the network
   * eventually reports what it delivered. Until this existed the customer saw
   * money as available for hours after the agent had already committed it, and
   * could budget or withdraw against it.
   *
   * Held after the launch rather than before it: a plan that never reached the
   * ad network never committed anything, and holding first would take money
   * out of the wallet for ads that do not exist. Placing the hold is not
   * allowed to undo a successful launch, so a failure here is recorded and the
   * launch still stands -- the stale-hold sweep and real spend both still
   * reconcile it.
   */
  let held = 0;
  try {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("spend_markup_bps")
      .eq("business_id", businessId)
      .maybeSingle();
    const planned = totalPlannedUsdMinor(plan.payload);
    if (planned > 0) {
      const { data: heldMinor } = await supabase.rpc("place_budget_hold", {
        p_business_id: businessId,
        p_plan_date: plan.plan_date,
        p_amount_usd_minor: holdAmountUsdMinor(
          planned,
          markupBpsOrDefault(sub?.spend_markup_bps as number | null | undefined),
        ),
      });
      held = Number(heldMinor ?? 0);
    }
  } catch (e) {
    await supabase.from("journal_entries").insert({
      business_id: businessId,
      entry_type: "note",
      content: { action: "budget_hold_failed", detail: { error: (e as Error).message } },
    });
  }

  void objectiveForGoal; // objective resolved at provisioning time
  return `launched ${summary.launched}, awaiting_payment ${summary.awaitingPayment}, errors ${summary.errors}, held ${held}`;
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
