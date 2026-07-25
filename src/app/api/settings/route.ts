import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MIN_DAILY_BUDGET_USD_MINOR } from "@/lib/money/ledger";

/**
 * Update the signed-in customer's business settings (UF-7). RLS on
 * `businesses` (owner_id = auth.uid()) scopes the update; only the whitelisted
 * fields are ever written, and the budget is floored at $10/day.
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { error } = await supabase.from("businesses").update(update).eq("id", business.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, updated: Object.keys(update) });
}
