import { cookies } from "next/headers";
import { configuredFounders, isFounder } from "./access";
import { ADMIN_COOKIE, readAdminSession } from "./session";
import { loadOpsCredentials } from "./credentials";
import { createClient } from "@/lib/supabase/server";

/**
 * Two locks on the founder console, and they are different kinds of lock.
 *
 * The FIRST is the magic-link session plus the email allowlist: proof of who
 * signed in. The SECOND is the authenticator code: proof that whoever is here
 * also holds the phone. The first alone was the whole gate until recently,
 * which meant a compromised email inbox was a compromised customer book —
 * the console reads through the service role and sees every wallet, address
 * and amount in the business.
 *
 * Both must pass. Failing either returns a reason the caller turns into a 404
 * or a prompt, so a stranger cannot even learn that the console is there.
 */
export type OpsGate =
  | { ok: true; email: string }
  | {
      ok: false;
      reason: "signed_out" | "not_founder" | "needs_code" | "needs_enrolment";
    };

export async function checkOpsGate(): Promise<OpsGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, reason: "signed_out" };
  if (!isFounder(user.email, configuredFounders())) return { ok: false, reason: "not_founder" };

  // No second factor has ever been set up. Distinguished from "wrong code"
  // so an allowlisted founder can be sent to enrol rather than shown a code
  // box they have no way to answer -- which is exactly the dead end the
  // env-var-only version created.
  const creds = await loadOpsCredentials();
  if (!creds) return { ok: false, reason: "needs_enrolment" };

  const jar = await cookies();
  const unlocked = readAdminSession(jar.get(ADMIN_COOKIE)?.value, creds.sessionSecret);
  // The second cookie must belong to the SAME person as the first. Without
  // this, an old unlock cookie from one account would carry over to another
  // signed in on the same browser.
  if (!unlocked || unlocked.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, reason: "needs_code" };
  }

  return { ok: true, email: user.email };
}
