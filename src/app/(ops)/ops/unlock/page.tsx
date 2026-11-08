import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import { opsEnrolled } from "@/lib/admin/credentials";
import { UnlockForm } from "@/components/ops/UnlockForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ops" };

/**
 * Ask for the authenticator code.
 *
 * A stranger never reaches this page: it 404s unless they are already signed
 * in on an allowlisted address. Someone who has stolen the founder's email
 * gets this far and no further, which is the entire reason it exists.
 */
export default async function UnlockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isFounder(user.email, configuredFounders())) notFound();

  // Nothing to type a code against yet. Send them to set one up rather than
  // showing a box they cannot possibly answer -- the dead end the
  // environment-variable-only version created the first time it was needed.
  if (!(await opsEnrolled())) redirect("/ops/enrol");

  return (
    <div className="mx-auto max-w-sm pt-16">
      <div className="datalabel">ops</div>
      <h1 className="gl-title mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em]">Second factor</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        This console reads across every customer, so a signed-in session is not
        enough on its own. Enter the current code from your authenticator app.
      </p>
      <UnlockForm />
    </div>
  );
}
