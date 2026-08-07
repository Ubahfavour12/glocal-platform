import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runForBusiness, type BizRow } from "@/lib/orchestrator/run-business";
import { asPlan } from "@/lib/billing/plan";

export const maxDuration = 300;

/**
 * On-demand regenerate: the customer disliked tomorrow's ads and wants a fresh
 * pair now, rather than waiting for the nightly run.
 *
 * Cost control, because this is the one button a customer can press repeatedly:
 *  - `skipRender` — no paid creative rendering. Rejecting the *words* must not
 *    burn a render credit each time; the nightly run renders normally.
 *  - `skipSideEffects` — no pipeline top-up or organic scheduling, so the only
 *    spend is the concept-writing and compliance calls (fractions of a cent).
 *  - A hard daily cap per business.
 *
 * Ownership is checked with the caller's own session (RLS) before any
 * service-role work happens.
 */
/**
 * Daily regenerate allowance. Free accounts get a couple of tries (enough to
 * feel the product); paying accounts get plenty, because at ~3 cents a rebuild
 * the cost is noise next to a subscription. The cap exists to stop a runaway
 * loop, not to ration a paying customer.
 */
const REGENERATIONS_PER_DAY = { free: 3, paid: 15 } as const;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { business_id?: string; concept_ids?: string[] }
    | null;
  if (!body?.business_id) {
    return NextResponse.json({ error: "business_id required" }, { status: 400 });
  }

  // RLS: this only finds the business when the caller owns it.
  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, category, goal, persona, full_auto, daily_budget_usd_minor, category_blocked, plan",
    )
    .eq("id", body.business_id)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "business not found" }, { status: 404 });
  }
  if (business.category_blocked) {
    return NextResponse.json(
      { error: "This business category cannot run ads." },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count } = await service
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .contains("content", { action: "plan_regenerated" })
    .gte("created_at", startOfDay.toISOString());

  const planTier = asPlan(business.plan as string | null);
  const allowance = REGENERATIONS_PER_DAY[planTier];

  if ((count ?? 0) >= allowance) {
    const upgradeHint =
      planTier === "free"
        ? " Upgrade for many more rewrites a day."
        : "";
    return NextResponse.json(
      {
        error: `You've asked for ${allowance} fresh plans today. I'll write a new one automatically this evening.${upgradeHint}`,
      },
      { status: 429 },
    );
  }

  try {
    const plan = await runForBusiness(service, business as BizRow, new Date(), {
      skipRender: true,
      skipSideEffects: true,
      preferConceptIds: body.concept_ids,
    });
    await service.from("journal_entries").insert({
      business_id: business.id,
      entry_type: "note",
      content: { action: "plan_regenerated", detail: { planDate: plan.planDate } },
    });
    return NextResponse.json({ ok: true, status: plan.status, challengers: plan.challengers.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "could not rebuild the plan" },
      { status: 500 },
    );
  }
}
