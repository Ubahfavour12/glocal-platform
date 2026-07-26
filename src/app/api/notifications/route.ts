import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { describeActivity, relativeTime, type RawEntry } from "@/lib/dashboard/activity";

/**
 * Recent agent activity for the in-app notification bell (Phase 3). Reuses the
 * same journal feed as /activity, mapped to plain-language lines. RLS-scoped to
 * the signed-in owner's business, the bell is a read-only convenience.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return NextResponse.json({ items: [] });

  const { data } = await supabase
    .from("journal_entries")
    .select("entry_type, content, created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(15);

  const items = ((data ?? []) as RawEntry[]).map((e) => ({
    text: describeActivity(e),
    time: e.created_at ? relativeTime(e.created_at) : "",
    at: e.created_at ?? null,
  }));

  return NextResponse.json({ items });
}
