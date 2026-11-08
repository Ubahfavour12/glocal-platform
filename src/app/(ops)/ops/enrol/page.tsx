import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import {
  formatSecretForTyping,
  generateSessionSecret,
  generateTotpSecret,
  opsEnrolled,
  otpauthUri,
} from "@/lib/admin/credentials";
import { EnrolForm } from "@/components/ops/EnrolForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ops", robots: { index: false, follow: false } };

/**
 * Set up the second factor, once, from whatever device is to hand.
 *
 * WHY THIS PAGE EXISTS. The seed used to live only in an environment
 * variable, so enrolling meant a terminal, the repository and a trusted
 * laptop. The first time the console was actually needed, none of those were
 * available — a security control nobody can enrol is a locked door with the
 * key in another city.
 *
 * THE WINDOW, STATED PLAINLY. Until somebody enrols, an allowlisted email is
 * the only thing standing between a visitor and this page, and whoever
 * enrols first owns the second factor. That is not a new weakness — it is
 * exactly the one-factor state the console has been in all along — but it
 * closes permanently the moment this is done, which is the argument for
 * doing it now rather than later.
 *
 * FIRST RUN ONLY. Once a credential exists this page 404s. Replacing a second
 * factor must not be something a single compromised inbox can do.
 *
 * The secret is generated per request and shown once. It is NOT stored until
 * a code computed from it comes back correct — so a seed that failed to
 * reach the phone can never become the one that locks everybody out.
 */
export default async function EnrolPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isFounder(user.email, configuredFounders())) notFound();

  if (await opsEnrolled()) redirect("/ops/unlock");

  const totpSecret = generateTotpSecret();
  const sessionSecret = generateSessionSecret();

  return (
    <div className="mx-auto max-w-md pt-12">
      <div className="datalabel">ops · first run</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Set up your second factor</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        This console reads across every customer, so a signed-in session is not
        enough on its own. Add the key below to an authenticator app, then type
        the code it shows to confirm it worked.
      </p>

      <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">setup key</div>
        <p className="mt-1 break-all font-mono text-base tracking-wide text-ink">
          {formatSecretForTyping(totpSecret)}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          In Google Authenticator: <span className="text-ink-muted">add a code</span> →{" "}
          <span className="text-ink-muted">enter a setup key</span>. Account name can be
          anything; type the key exactly, spaces optional, and leave it on
          time-based.
        </p>
      </div>

      <EnrolForm totpSecret={totpSecret} sessionSecret={sessionSecret} uri={otpauthUri(totpSecret, user.email)} />

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        Nothing is saved until the code checks out, so a mistyped key cannot
        lock you out — reload and start again. Once saved, this page stops
        existing and the key is never shown anywhere a second time.
      </p>
    </div>
  );
}
