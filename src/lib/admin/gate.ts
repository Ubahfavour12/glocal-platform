import { cookies } from "next/headers";
import { configuredFounders, isFounder } from "./access";
import { ADMIN_COOKIE, adminSessionConfigured, readAdminSession } from "./session";
import { totpConfigured } from "./totp";
import { createClient } from "@/lib/supabase/server";

/**
 * Two locks on the founder console, and they are different kinds of lock.
 *
 * The FIRST is the magic-link session plus the email allowlist: proof of who
 * signed in. The SECOND is the authenticator code: proof that whoever is here
 * also holds the phone. The first alone was the whole gate until now, which
 * meant a compromised email inbox was a compromised customer book -- the
 * console reads through the service role and sees every wallet, address and
 * amount in the business.
 *
 * Both must pass. Failing either returns null and the page 404s, so a stranger
 * cannot even learn that the console is there.
 */
export type OpsGate =
  | { ok: true; email: string }
  | { ok: false; reason: "signed_out" | "not_founder" | "needs_code" | "unconfigured" };

export async function checkOpsGate(): Promise<OpsGate> {
  // Refuse before checking anything else when the second factor has not been
  // set up. Otherwise a deploy with a missing env var would quietly serve the
  // console on one factor -- the exact state this exists to end, arriving
  // silently.
  if (!totpConfigured() || !adminSessionConfigured()) {
    return { ok: false, reason: "unconfigured" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, reason: "signed_out" };
  if (!isFounder(user.email, configuredFounders())) return { ok: false, reason: "not_founder" };

  const jar = await cookies();
  const unlocked = readAdminSession(jar.get(ADMIN_COOKIE)?.value);
  // The second cookie must belong to the SAME person as the first. Without
  // this, an old unlock cookie from one account would carry over to another
  // signed in on the same browser.
  if (!unlocked || unlocked.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, reason: "needs_code" };
  }

  return { ok: true, email: user.email };
}
