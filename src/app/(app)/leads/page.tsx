import { createClient } from "@/lib/supabase/server";
import { LeadList } from "@/components/leads/LeadList";
import { AddLead } from "@/components/leads/AddLead";
import { nudgeMessage, shouldNudge } from "@/lib/leads/nudge";
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

  // The prompt is computed from the leads themselves rather than stored, so
  // there is no separate piece of state to fall out of step with reality.
  const open = leads.filter((l) => l.status !== "won" && l.status !== "lost");
  const settledDates = leads
    .filter((l) => l.status === "won" || l.status === "lost")
    .map((l) => new Date(l.created_at).getTime());
  const nudge = shouldNudge({
    openCount: open.length,
    oldestOpenAt:
      open.length > 0
        ? new Date(Math.min(...open.map((l) => new Date(l.created_at).getTime())))
        : null,
    lastAnsweredAt: settledDates.length > 0 ? new Date(Math.max(...settledDates)) : null,
    now: new Date(),
  });
  const prompt = nudgeMessage(nudge);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="datalabel">leads</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        Did they turn into business?
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        Every lead here came from one of your ads, so answering tells Glocal
        which ad brought real customers — not just the most enquiries. Come and
        fill these in whenever you like; Glocal only brings it up every few days.
      </p>

      {prompt ? (
        <div
          className={`mt-6 rounded-card border p-4 ${
            nudge.show && nudge.tone === "stale"
              ? "border-negative bg-surface-raised"
              : "border-accent bg-surface-raised"
          }`}
        >
          <p className="text-sm text-ink">{prompt}</p>
        </div>
      ) : null}

      <div className="mt-6">
        <AddLead />
      </div>

      <div className="mt-8">
        <LeadList leads={leads} />
      </div>
    </main>
  );
}
