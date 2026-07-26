import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildInstagramAuthorizeUrl, instagramOAuthConfigFromEnv } from "@/lib/oauth/instagram";

/**
 * Begin "Connect Instagram" (direct Instagram login, no Facebook Page needed).
 * Requires a signed-in owner, mints a CSRF state cookie, and redirects to
 * Instagram's own consent screen. For accounts not linked to a Facebook Page.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  let cfg;
  try {
    cfg = instagramOAuthConfigFromEnv(origin);
  } catch {
    return NextResponse.redirect(`${origin}/settings?connect=ig_unconfigured`);
  }

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("instagram_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildInstagramAuthorizeUrl(cfg, state));
}
