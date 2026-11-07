import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runForBusiness, type BizRow } from "@/lib/orchestrator/run-business";
import { isDormant } from "@/lib/orchestrator/dormant";

export const maxDuration = 300;

/**
 * The nightly run, Vercel cron (see vercel.json), CRON_SECRET auth like
 * reconcile. For every business: live metrics (when a Meta child account
 * exists) -> verdict + fatigue -> plan -> gateway -> approvals row awaiting
 * the evening tap. Businesses without live ads still get a plan from their
 * concept pool; adapters degrade service-by-service, never crash the run.
 *
 * The per-business work lives in `lib/orchestrator/run-business` so the
 * customer-facing "Regenerate" button runs exactly the same planner.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const results: { businessId: string; status: string }[] = [];

  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("id, name, category, goal, persona, full_auto, daily_budget_usd_minor, category_blocked, plan");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Dormancy signals, read once for everyone rather than three queries per
  // business. At this scale either would do; as a per-row lookup it would be
  // the thing that makes the nightly run slow later, and it is three lines
  // either way.
  const [adAccountsRes, socialsRes, balancesRes] = await Promise.all([
    supabase.from("ad_accounts").select("business_id"),
    supabase.from("social_connections").select("business_id").eq("status", "active"),
    supabase.from("wallet_balances").select("business_id, balance_usd_minor"),
  ]);
  const withAdAccount = new Set(
    (adAccountsRes.data ?? []).map((r) => String(r.business_id)),
  );
  const withSocial = new Set((socialsRes.data ?? []).map((r) => String(r.business_id)));
  const balances = new Map(
    (balancesRes.data ?? []).map((r) => [
      String(r.business_id),
      Number(r.balance_usd_minor ?? 0),
    ]),
  );

  for (const biz of businesses ?? []) {
    if (biz.category_blocked) {
      results.push({ businessId: biz.id, status: "skipped_blocked_category" });
      continue;
    }
    // Nowhere to advertise, nowhere to post, nothing to spend. Everything this
    // loop would produce for them is work nobody can act on, and it is billed
    // to us either way. Opens again by itself the night after they connect or
    // top up -- nothing marks the account and nothing has to un-mark it.
    if (
      isDormant({
        hasAdAccount: withAdAccount.has(biz.id),
        hasSocial: withSocial.has(biz.id),
        balanceUsdMinor: balances.get(biz.id) ?? 0,
      })
    ) {
      results.push({ businessId: biz.id, status: "skipped_dormant" });
      continue;
    }
    try {
      const plan = await runForBusiness(supabase, biz as BizRow, now);
      results.push({ businessId: biz.id, status: plan.status });
    } catch (e) {
      results.push({ businessId: biz.id, status: `error: ${(e as Error).message}` });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
