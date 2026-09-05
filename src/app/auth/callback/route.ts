import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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
 *
 * On failure we say WHY, because the two causes need different actions from
 * the customer and both previously looked like being dumped back on the email
 * form for no reason:
 *
 *   device  - a PKCE link opened somewhere other than the browser that asked
 *             for it. Requesting the link stores a one-time code verifier in
 *             that browser; without it the code cannot be exchanged, no matter
 *             how fresh the link is. Requesting on a laptop and opening on a
 *             phone lands here, as does an email app that opens links in its
 *             own in-app browser.
 *   expired - the link is genuinely used up or too old.
 */
type FailureReason = "device" | "expired" | "link";

/**
 * Does this browser hold the PKCE verifier that pairs with an emailed code?
 *
 * Checked directly rather than inferred from the error text, which is provider
 * wording and can change underneath us. @supabase/ssr stores the verifier in a
 * cookie whose name ends in `-code-verifier`.
 */
async function hasCodeVerifier(): Promise<boolean> {
  const store = await cookies();
  return store.getAll().some((c) => c.name.endsWith("-code-verifier") && c.value);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let authed = false;
  let reason: FailureReason = "link";

  if (code) {
    if (!(await hasCodeVerifier())) {
      // Exchanging would fail anyway; naming the cause beats a generic error.
      reason = "device";
    } else {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      authed = !error;
      if (error) reason = "expired";
    }
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
    // token_hash is device-independent, so a failure here is a spent or stale
    // link rather than the wrong browser.
    if (!authed) reason = "expired";
  }

  if (!authed) {
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  // RLS scopes this to the just-signed-in user.
  const { data } = await supabase.from("businesses").select("id").limit(1);
  const target = data && data.length > 0 ? "/today" : "/onboarding";
  return NextResponse.redirect(`${origin}${target}`);
}
