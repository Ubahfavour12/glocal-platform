"use client";

import { useRouter } from "next/navigation";
import { LeadRow, type Lead } from "./LeadRow";

/**
 * The weekly ask.
 *
 * Open leads first, because those are the only ones with a question attached.
 * Settled ones follow as a short record, so the page shows progress rather
 * than emptying itself as you work and leaving you unsure you saved anything.
 *
 * `router.refresh()` rather than local state: the page is a server component
 * reading the database, and re-fetching keeps one source of truth. Optimistic
 * local updates would drift from what was actually stored the moment a write
 * is refused — and a refusal is expected here, since a won lead without its
 * value is deliberately rejected.
 */
export function LeadList({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const open = leads.filter((l) => l.status !== "won" && l.status !== "lost");
  const settled = leads.filter((l) => l.status === "won" || l.status === "lost");

  if (leads.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface-raised p-5">
        <p className="text-sm text-ink-muted">
          No leads yet. They appear here automatically when someone fills in a
          lead form on one of your ads, and you can add a walk-in by hand.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {open.length > 0 ? (
        <section>
          <div className="datalabel">
            {open.length} waiting on you
          </div>
          <p className="mt-1.5 text-sm text-ink-muted">
            Which of these turned into business? One tap each. This is the only
            thing Glocal cannot work out on its own — and it is what tells the
            agent which ads to put your money behind.
          </p>
          <ul className="mt-4 space-y-2">
            {open.map((l) => (
              <LeadRow key={l.id} lead={l} onDone={() => router.refresh()} />
            ))}
          </ul>
        </section>
      ) : (
        <div className="rounded-card border border-line bg-surface-raised p-5">
          <p className="text-sm text-ink-muted">
            Nothing waiting. Every lead has been settled.
          </p>
        </div>
      )}

      {settled.length > 0 ? (
        <section>
          <div className="datalabel">settled</div>
          <ul className="mt-3 space-y-2">
            {settled.map((l) => (
              <LeadRow key={l.id} lead={l} onDone={() => router.refresh()} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
