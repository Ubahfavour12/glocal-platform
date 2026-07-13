import { NextResponse } from "next/server";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import { createClient } from "@/lib/supabase/server";

/**
 * DEV ONLY: seed a sample awaiting plan for the signed-in user's first
 * business, so the approval card is demonstrable before the live nightly
 * orchestrator (with Higgsfield renders) runs. Removed before launch.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "finish onboarding first" }, { status: 404 });
  }

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const payload: ApprovalPlanPayload = {
    planDate: tomorrow,
    currency: "USD",
    championBudgetUsdMinor: 700,
    challengers: [
      {
        conceptId: "seed-a",
        hook: "The 3-second hook that stopped the scroll",
        copy: "New season styles just landed. Tap to see them all.",
        budgetUsdMinor: 150,
      },
      {
        conceptId: "seed-b",
        hook: "POV: you found the shop everyone's talking about",
        copy: "Message us on WhatsApp — we reply in minutes.",
        budgetUsdMinor: 150,
      },
    ],
    commentary: [
      "I kept yesterday's winner as champion and gave it 70% of the budget.",
      "Both challengers passed the compliance check on the first try.",
    ],
    scoreboard: {
      note: "This is your first plan — no duel to judge yet. Tomorrow starts the clock.",
    },
  };

  // upsert on (business_id, plan_date) so re-seeding is safe
  const { error } = await supabase
    .from("approvals")
    .upsert(
      { business_id: business.id, plan_date: tomorrow, payload, status: "awaiting" },
      { onConflict: "business_id,plan_date" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, plan_date: tomorrow });
}
