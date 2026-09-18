import { createClient } from "@/lib/supabase/server";
import { LeadList } from "@/components/leads/LeadList";
import type { Lead } from "@/components/leads/LeadRow";

export const dynamic = "force-dynamic";

/**
 * Leads — and the one question the agent cannot answer for itself.
 *
 * Glocal can see that a lead arrived and which ad produced it. It cannot see
 * whether that lead became a customer; only the owner knows, usually from a
 * WhatsApp conversation. So this page asks, and each answer turns into the
 * number that actually matters: cost per WON deal, per creative.
 *
 * Without it the verdict engine rewards whichever ad produces the cheapest
 * leads, which is exactly wrong when cheap leads never close — the complaint a
 * social media manager put more plainly as "lead quality is the biggest pain
 * point".
 */
export default async function LeadsPage() {
  const supabase = await createClient();

  // RLS scopes this to the signed-in owner's business; no explicit filter is
  // needed and adding one would be a second place to get it wrong.
  const { data } = await supabase
    .from("leads")
    .select("id, label, status, source, created_at, value_usd_minor")
    .order("created_at", { ascending: false })
    .limit(200);

  const leads = (data ?? []) as Lead[];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="datalabel">leads</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        Did they turn into business?
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        Every lead here came from one of your ads, so answering tells Glocal
        which ad brought real customers — not just the most enquiries.
      </p>

      <div className="mt-8">
        <LeadList leads={leads} />
      </div>
    </main>
  );
}
