import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Email-link landing (UF-1), server-side (SSR) compatible.
 *
 * The default Supabase email template uses the implicit flow, which delivers
 * the session in the URL fragment, unreadable by a server route, so it can
 * never sign the user in. The email templates therefore point HERE with a
 * `token_hash` + `type`, which we verify server-side (verifyOtp). A `?code=`
 * (OAuth/PKCE) is exchanged as a fallback.
 *
 * On success we route by whether onboarding is done:
 *   new user  -> /onboarding (collect their business, then the agent wakes)
 *   returning -> /today (straight to the dashboard, no re-onboarding)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let authed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    authed = !error;
  } else if (tokenHash) {
    // A NEW signup's link carries a "signup" token; a returning user's carries
    // "magiclink"/"email". If the template's ?type= doesn't match the token's
    // real type, verifyOtp rejects it and the user gets bounced to /login.
    // Try the declared type first, then fall back across the email OTP types so
    // both new and returning links work regardless of what ?type= says.
    const candidates: EmailOtpType[] = [];
    for (const t of [type, "email", "signup", "magiclink"] as (EmailOtpType | null)[]) {
      if (t && !candidates.includes(t)) candidates.push(t);
    }
    for (const t of candidates) {
      const { error } = await supabase.auth.verifyOtp({ type: t, token_hash: tokenHash });
      if (!error) {
        authed = true;
        break;
      }
    }
  }

  if (!authed) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  // RLS scopes this to the just-signed-in user.
  const { data } = await supabase.from("businesses").select("id").limit(1);
  const target = data && data.length > 0 ? "/today" : "/onboarding";
  return NextResponse.redirect(`${origin}${target}`);
}
