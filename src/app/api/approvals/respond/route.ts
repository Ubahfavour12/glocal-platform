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
    | { approval_id?: string; response?: string }
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
  return NextResponse.json({ ok: true, status: body.response });
}
