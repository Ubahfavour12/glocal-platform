import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import { totpConfigured } from "@/lib/admin/totp";
import { adminSessionConfigured } from "@/lib/admin/session";
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
  if (!totpConfigured() || !adminSessionConfigured()) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isFounder(user.email, configuredFounders())) notFound();

  return (
    <div className="mx-auto max-w-sm pt-16">
      <div className="datalabel">ops</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Second factor</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        This console reads across every customer, so a signed-in session is not
        enough on its own. Enter the current code from your authenticator app.
      </p>
      <UnlockForm />
    </div>
  );
}
