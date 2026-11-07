import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SESSION_COOKIES } from "@/lib/auth/session-policy";

/**
 * Sign out.
 *
 * Done on the server rather than from the browser because the Supabase session
 * lives in httpOnly cookies: a client-side signOut cannot clear what the
 * browser is not allowed to touch, so the server has to write the clears.
 *
 * It also deletes the three session-policy cookies. `proxy.ts` already learned
 * this the hard way on its timeout path -- leaving them behind means the next
 * visitor on the same browser inherits a half-expired session clock belonging
 * to someone who has signed out. Signing out must leave nothing behind.
 *
 * POST only: a GET would let any page that embeds an image or a link sign the
 * customer out without them meaning to.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const res = NextResponse.json({ ok: true });
  for (const name of SESSION_COOKIES) res.cookies.delete(name);
  return res;
}
