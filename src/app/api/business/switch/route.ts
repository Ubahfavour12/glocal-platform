import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_COOKIE } from "@/lib/business/current";

/**
 * Switch which business the account is working on.
 *
 * The ownership check happens HERE as well as at every read, even though
 * row-level security would catch it anyway. Writing a cookie that names
 * somebody else's business would leave a user in a state where every page
 * silently falls back — looking like the switch worked and then quietly
 * showing the wrong thing. Refusing up front says what actually happened.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { businessId?: string } | null;
  if (!body?.businessId) {
    return NextResponse.json({ error: "which business?" }, { status: 400 });
  }

  // Read through the user's own client: RLS proves ownership rather than this
  // route asserting it.
  const { data } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", body.businessId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not your business" }, { status: 404 });

  const res = NextResponse.json({ businessId: data.id });
  res.cookies.set(BUSINESS_COOKIE, data.id as string, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
