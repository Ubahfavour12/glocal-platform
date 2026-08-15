import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * UF-4: the customer responds to the evening plan. RLS + the
 * respond_to_approval function guarantee a user can only act on their own
 * business's approvals.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { approval_id?: string; response?: string; scheduled_for?: string | null }
    | null;
  const allowed = ["approved", "regenerating", "swapped"];
  if (!body?.approval_id || !allowed.includes(body.response ?? "")) {
    return NextResponse.json(
      { error: "approval_id and response (approved|regenerating|swapped) required" },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc("respond_to_approval", {
    p_approval_id: body.approval_id,
    p_response: body.response,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // When the customer picked a launch time, record it. Written separately from
  // the RPC so approving never fails because of a bad timestamp: the approval
  // is the important part, the timing is a refinement on top.
  if (body.response === "approved" && body.scheduled_for !== undefined) {
    const when = body.scheduled_for ? new Date(body.scheduled_for) : null;
    const valid = when === null || !Number.isNaN(when.getTime());
    if (valid) {
      await supabase
        .from("approvals")
        .update({ scheduled_for: when ? when.toISOString() : null })
        .eq("id", body.approval_id);
    }
  }

  return NextResponse.json({ ok: true, status: body.response });
}
