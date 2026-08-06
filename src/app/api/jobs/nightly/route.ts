import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runForBusiness, type BizRow } from "@/lib/orchestrator/run-business";

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
    .select("id, name, category, goal, persona, full_auto, daily_budget_usd_minor, category_blocked");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const biz of businesses ?? []) {
    if (biz.category_blocked) {
      results.push({ businessId: biz.id, status: "skipped_blocked_category" });
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
