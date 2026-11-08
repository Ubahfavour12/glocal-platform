import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import {
  ENROLMENT_WINDOW_MINUTES,
  beginEnrolment,
  formatSecretForTyping,
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
 * WHY THE KEY NOW COMES FROM `beginEnrolment`. It was generated right here, in
 * this function, under `force-dynamic` — so every render produced a new key.
 * Read the key, switch to the authenticator app, come back, and the browser
 * had re-fetched the page: the phone held one key, the form carried another,
 * and a perfectly typed code was refused as wrong with no hint why. The
 * candidate now lives server-side for half an hour and this page displays
 * whatever is in flight, so re-rendering is harmless.
 *
 * THE WINDOW, STATED PLAINLY. Until somebody enrols, an allowlisted email is
 * the only thing standing between a visitor and this page, and whoever
 * enrols first owns the second factor. That is not a new weakness — it is
 * exactly the one-factor state the console has been in all along — but it
 * closes permanently the moment this is done, which is the argument for
 * doing it now rather than later.
 *
 * FIRST RUN ONLY. Once a credential exists this page sends you to unlock
 * instead. Replacing a second factor must not be something a single
 * compromised inbox can do.
 *
 * The candidate is not a credential: the gate reads `ops_credentials` and
 * never the candidate table, so a key that never reached a phone can still
 * never lock anybody out. Only a correct code promotes it.
 */
export default async function EnrolPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isFounder(user.email, configuredFounders())) notFound();

  if (await opsEnrolled()) redirect("/ops/unlock");

  const candidate = await beginEnrolment(user.email);

  // No key rather than a key that cannot be verified afterwards. Showing one
  // generated in this process, with nothing on the server to check it
  // against, is how the original bug looked from the outside.
  if (!candidate) {
    return (
      <div className="mx-auto max-w-md pt-12">
        <div className="datalabel">ops · first run</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Not right now</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The setup key could not be prepared, so there would be nothing to
          check your code against. Reload this page to try again.
        </p>
      </div>
    );
  }

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
          {formatSecretForTyping(candidate.totpSecret)}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          In Google Authenticator: <span className="text-ink-muted">add a code</span> →{" "}
          <span className="text-ink-muted">enter a setup key</span>. Account name can be
          anything; type the key exactly, spaces optional, and leave the type on{" "}
          <span className="text-ink-muted">time based</span> — counter based will never
          produce a code this accepts.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          This is the same key for the next {ENROLMENT_WINDOW_MINUTES} minutes, so
          switching to your authenticator app and back — or reloading — is safe.
        </p>
      </div>

      <EnrolForm uri={otpauthUri(candidate.totpSecret, user.email)} />

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        Nothing becomes your second factor until the code checks out, so a
        mistyped key cannot lock you out — delete the entry in your
        authenticator, reload, and add the key again. Once saved, this page
        stops existing and the key is never shown anywhere a second time.
      </p>
    </div>
  );
}
