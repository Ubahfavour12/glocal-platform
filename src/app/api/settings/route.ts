import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MIN_DAILY_BUDGET_USD_MINOR } from "@/lib/money/ledger";
import { runForBusiness, type BizRow } from "@/lib/orchestrator/run-business";

export const maxDuration = 300;

/** Changing these invalidates a plan that is still waiting for approval. */
const PLAN_AFFECTING = new Set(["daily_budget_usd_minor", "persona", "goal"]);

/**
 * Update the signed-in customer's business settings (UF-7). RLS on
 * `businesses` (owner_id = auth.uid()) scopes the update; only the whitelisted
 * fields are ever written, and the budget is floored at $10/day.
 *
 * If the change affects tomorrow's plan (budget, persona, goal) and a plan is
 * still awaiting approval, we rebuild it immediately. Otherwise the customer
 * raises their budget and the card keeps showing yesterday's numbers, which
 * reads as the app ignoring them.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    daily_budget_usd_minor?: number;
    goal?: string;
    persona?: string;
    full_auto?: boolean;
    launch_hour?: number;
    launch_timezone?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return NextResponse.json({ error: "no business" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (typeof body.daily_budget_usd_minor === "number") {
    update.daily_budget_usd_minor = Math.max(
      MIN_DAILY_BUDGET_USD_MINOR,
      Math.round(body.daily_budget_usd_minor),
    );
  }
  if (body.goal && ["sales", "leads", "whatsapp", "visits"].includes(body.goal)) {
    update.goal = body.goal;
  }
  if (body.persona && ["conservative", "smart", "aggressive"].includes(body.persona)) {
    update.persona = body.persona;
  }
  if (typeof body.full_auto === "boolean") update.full_auto = body.full_auto;
  // Clamped rather than rejected: an out-of-range hour is a client bug, and
  // refusing the whole save would lose the customer's other changes with it.
  if (Number.isFinite(body.launch_hour)) {
    update.launch_hour = Math.min(23, Math.max(0, Math.round(body.launch_hour as number)));
  }
  if (typeof body.launch_timezone === "string" && body.launch_timezone.length <= 64) {
    update.launch_timezone = body.launch_timezone;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { error } = await supabase.from("businesses").update(update).eq("id", business.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Rebuild a pending plan so the new numbers take effect straight away.
  let replanned = false;
  const touchesPlan = Object.keys(update).some((k) => PLAN_AFFECTING.has(k));
  if (touchesPlan) {
    try {
      const service = createServiceClient();
      const { data: pending } = await service
        .from("approvals")
        .select("id")
        .eq("business_id", business.id)
        .eq("status", "awaiting")
        .is("launched_at", null)
        .maybeSingle();

      if (pending) {
        const { data: fresh } = await service
          .from("businesses")
          .select(
            "id, name, category, goal, persona, full_auto, daily_budget_usd_minor, category_blocked",
          )
          .eq("id", business.id)
          .maybeSingle();
        if (fresh && !fresh.category_blocked) {
          await runForBusiness(service, fresh as BizRow, new Date(), {
            skipRender: true,
            skipSideEffects: true,
          });
          replanned = true;
        }
      }
    } catch {
      // Settings still saved; the nightly run will pick the new numbers up.
    }
  }

  return NextResponse.json({ ok: true, updated: Object.keys(update), replanned });
}
