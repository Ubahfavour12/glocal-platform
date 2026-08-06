"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentNote } from "@/components/ui/AgentNote";
import { SalesCheckIn, type SellableAd } from "@/components/approval/SalesCheckIn";
import { totalPlannedUsdMinor, type ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";

/**
 * The evening approval card, Blueprint §2.2 / UF-4. The single human moment
 * in the daily loop: the customer sees tomorrow's plan and taps once.
 */
export function ApprovalCard({
  approvalId,
  plan,
  businessId,
  ads = [],
}: {
  approvalId: string;
  plan: ApprovalPlanPayload;
  businessId?: string;
  ads?: SellableAd[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const total = totalPlannedUsdMinor(plan);
  const championPct = total > 0 ? Math.round((plan.championBudgetUsdMinor / total) * 100) : 0;

  const [notice, setNotice] = useState("");

  async function respond(response: "approved" | "regenerating") {
    setBusy(response);
    setError("");
    setNotice("");
    const res = await fetch("/api/approvals/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, response }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "could not submit");
      return;
    }
    if (response === "regenerating") {
      // The plan is rebuilt by the agent, not instantly in the browser. Say so
      // plainly instead of leaving the card looking like nothing happened.
      setNotice(
        "Got it, I'll throw these out and write you a fresh pair. The new plan lands here this evening.",
      );
      return;
    }
    router.refresh();
  }

  const money = (m: number) => `$${(m / 100).toFixed(2)}`;

  return (
    <div className="mx-auto max-w-lg">
      <div className="datalabel">tomorrow&apos;s plan · {plan.planDate}</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ready for your approval</h1>

      {/* Yesterday's sales check-in. Only shown once ads have actually run:
          with nothing live there is no sale to attribute and nothing to pick. */}
      {businessId && ads.length > 0 && <SalesCheckIn businessId={businessId} ads={ads} />}

      {/* yesterday's scoreboard */}
      <div className="mt-6">
        <AgentNote>{plan.scoreboard.note}</AgentNote>
      </div>

      {/* budget split bar */}
      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <span className="datalabel">daily budget · {money(total)}</span>
          <span className="datalabel">{championPct}% champion</span>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-overlay">
          <div className="bg-accent" style={{ width: `${championPct}%` }} />
          <div className="bg-accent-bright/40" style={{ width: `${100 - championPct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-faint">
          <span>Champion {money(plan.championBudgetUsdMinor)}</span>
          <span>Challengers {money(total - plan.championBudgetUsdMinor)}</span>
        </div>
      </section>

      {/* the two challengers */}
      <section className="mt-4 grid gap-3">
        {plan.challengers.map((c, i) => (
          <div key={c.conceptId} className="rounded-card border border-line bg-surface-raised p-4">
            <div className="flex items-center justify-between">
              <span className="datalabel">challenger {String.fromCharCode(65 + i)}</span>
              <span className="font-mono text-sm text-ink-muted">{money(c.budgetUsdMinor)}/day</span>
            </div>
            <div className="mt-2 flex gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-overlay">
                {c.mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.mediaUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                    render
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-ink">{c.hook}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{c.copy}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* agent commentary */}
      {plan.commentary.length > 0 && (
        <section className="mt-4 flex flex-col gap-2">
          {plan.commentary.map((line, i) => (
            <p key={i} className="text-xs leading-relaxed text-ink-muted">
             , {line}
            </p>
          ))}
        </section>
      )}

      {/* actions */}
      <div className="mt-6 flex gap-3">
        <button
          disabled={busy !== null}
          onClick={() => respond("approved")}
          className="flex-1 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {busy === "approved" ? "Approving…" : "Approve & launch tomorrow"}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => respond("regenerating")}
          className="rounded-lg border border-line px-5 py-3 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          {busy === "regenerating" ? "…" : "Regenerate"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      {notice && (
        <div className="mt-3 rounded-card border-l-2 border-accent bg-accent-soft px-4 py-3 text-sm text-ink">
          {notice}
        </div>
      )}
      <p className="mt-3 text-center text-xs text-ink-faint">
        Nothing spends until you approve. Ads launch tomorrow morning, always paused first.
      </p>
      <p className="mt-4 text-center text-xs text-ink-faint">
        Want to spend more or less per day?{" "}
        <a href="/settings" className="text-accent hover:text-accent-bright">
          Adjust your budget
        </a>
      </p>
    </div>
  );
}
