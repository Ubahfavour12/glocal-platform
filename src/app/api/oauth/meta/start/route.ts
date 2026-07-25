import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl, metaOAuthConfigFromEnv } from "@/lib/oauth/meta";

/**
 * Begin "Connect Facebook/Instagram". Requires a signed-in owner, mints a
 * CSRF state cookie, and redirects to Meta's consent dialog. The customer
 * authorizes on Meta's own site; nothing sensitive passes through us.
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
    cfg = metaOAuthConfigFromEnv(origin);
  } catch {
    return NextResponse.redirect(`${origin}/settings?connect=unconfigured`);
  }

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes to complete the flow
    path: "/",
  });

  return NextResponse.redirect(buildAuthorizeUrl(cfg, state));
}
