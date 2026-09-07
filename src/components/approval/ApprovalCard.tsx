"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentNote } from "@/components/ui/AgentNote";
import { SalesCheckIn, type SellableAd } from "@/components/approval/SalesCheckIn";
import { totalPlannedUsdMinor, type ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import {
  defaultLaunchAt,
  describeLaunchAt,
  launchSuggestion,
  resolveLaunchAt,
  type LaunchChoice,
} from "@/lib/orchestrator/launch-timing";

/**
 * The evening approval card, Blueprint §2.2 / UF-4. The single human moment
 * in the daily loop: the customer sees tomorrow's plan and taps once.
 */
/** How each persona reads to a shop owner, rather than its internal name. */
const PERSONA_LABEL: Record<string, string> = {
  conservative: "playing it safe",
  smart: "balanced",
  aggressive: "testing hard",
};

export function ApprovalCard({
  approvalId,
  plan,
  businessId,
  ads = [],
  balanceUsdMinor = 0,
  requiredUsdMinor = 0,
}: {
  approvalId: string;
  plan: ApprovalPlanPayload;
  businessId?: string;
  ads?: SellableAd[];
  /** Wallet balance, so the card can tell whether approving will do anything. */
  balanceUsdMinor?: number;
  /** Seven days of budget, the hold that has to clear before ads can run. */
  requiredUsdMinor?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // When to go live. The agent suggests, the customer decides.
  const [when, setWhen] = useState<LaunchChoice>("default");
  const [customAt, setCustomAt] = useState("");

  // Approving an unfunded plan queues it and then nothing happens. Saying so
  // up front is the difference between a decision and a nag.
  const shortfallUsdMinor = Math.max(0, requiredUsdMinor - balanceUsdMinor);
  const unfunded = requiredUsdMinor > 0 && shortfallUsdMinor > 0;

  const total = totalPlannedUsdMinor(plan);
  const championPct = total > 0 ? Math.round((plan.championBudgetUsdMinor / total) * 100) : 0;

  async function approve() {
    setBusy("approved");
    setError("");
    const now = new Date();
    const launchAt = resolveLaunchAt(when, now, customAt || undefined);

    const res = await fetch("/api/approvals/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approval_id: approvalId,
        response: "approved",
        scheduled_for: launchAt ? launchAt.toISOString() : null,
      }),
    });
    if (!res.ok) {
      setBusy(null);
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "could not submit");
      return;
    }

    // "Now" cannot wait for a once-a-day cron, so trigger the launcher directly.
    if (when === "now") {
      await fetch("/api/plan/launch-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approvalId }),
      }).catch(() => null);
    }

    setBusy(null);
    router.refresh();
  }

  /**
   * Regenerate for real: record the rejection, then rebuild the plan on demand
   * and show the new one. Takes a while (the agent writes fresh concepts and
   * compliance-checks them), so the button says what it is doing.
   */
  async function regenerate() {
    setBusy("regenerating");
    setError("");
    await fetch("/api/approvals/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, response: "regenerating" }),
    }).catch(() => null);

    const res = await fetch("/api/plan/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "could not rebuild the plan, I'll write a fresh one this evening");
      return;
    }
    router.refresh();
  }

  const money = (m: number) => `$${(m / 100).toFixed(2)}`;

  return (
    <div className="mx-auto max-w-lg md:max-w-3xl">
      <div className="datalabel">tomorrow&apos;s plan · {plan.planDate}</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ready for your approval</h1>

      {unfunded && (
        <section className="mt-5 rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">before any of this can run</div>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            Your wallet has {money(balanceUsdMinor)} and starting needs{" "}
            {money(requiredUsdMinor)} in it, seven days of your budget. Nothing is taken
            now. You can approve this plan and I will keep it ready, but it cannot run
            until the balance is there.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/wallet"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Add {money(shortfallUsdMinor)}
            </a>
            <a
              href="/settings"
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Lower the daily budget
            </a>
          </div>
        </section>
      )}

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
          <span className="datalabel">
            {championPct}% champion
            {plan.persona ? ` · ${PERSONA_LABEL[plan.persona]}` : ""}
          </span>
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

      {/* the two challengers, side by side once there's room for a head-to-head read */}
      <section className="mt-4 grid gap-3 md:grid-cols-2">
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

      {/* Agent commentary. The first line is already the headline note above,
          so skip it here rather than saying the same thing twice. */}
      {plan.commentary.length > 1 && (
        <section className="mt-4 flex flex-col gap-2">
          {plan.commentary.slice(1).map((line, i) => (
            <p key={i} className="text-xs leading-relaxed text-ink-muted">
              {line}
            </p>
          ))}
        </section>
      )}

      {/* When to go live, decided before the tap rather than after it.
          The old layout put a small row of choices above one big amber button
          reading "Approve & launch tomorrow", which told everyone tomorrow was
          the answer and the row above was for people who like settings. Most
          never touched it, so most never learned they could be live in ten
          minutes. The choice is the screen now, and the button reports the
          consequence of the choice rather than presuming one. */}
      <section className="mt-5">
        <div className="datalabel">when should these go live</div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {(
            [
              ["now", "Right away", "Live within minutes of approving."],
              ["default", "Tomorrow morning", launchSuggestion(new Date())],
              ["custom", "Pick a date and time", "I hold the plan until the moment you choose."],
            ] as [LaunchChoice, string, string][]
          ).map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              onClick={() => setWhen(key)}
              className={`flex items-start justify-between gap-3 rounded-card border p-4 text-left transition-colors ${
                when === key
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface-raised hover:border-ink-faint"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">{label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{hint}</span>
              </span>
              {when === key && (
                <svg
                  viewBox="0 0 24 24"
                  className="h-[19px] w-[19px] shrink-0 text-accent"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {when === "custom" && (
          <input
            type="datetime-local"
            value={customAt}
            onChange={(e) => setCustomAt(e.target.value)}
            aria-label="Launch date and time"
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
        )}
      </section>

      {/* actions. The button says what will happen, so nobody has to work it
          out from a control they may never have noticed. */}
      <div className="mt-5 flex gap-3">
        <button
          disabled={busy !== null}
          onClick={approve}
          className="flex-1 rounded-lg bg-accent px-6 py-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {busy === "approved"
            ? "Approving…"
            : unfunded
              ? "Approve and hold until funded"
              : when === "now"
                ? "Approve and launch now"
                : when === "custom" && customAt
                  ? `Approve and launch ${describeLaunchAt(new Date(customAt), new Date())}`
                  : `Approve and launch ${describeLaunchAt(defaultLaunchAt(new Date()), new Date())}`}
        </button>
        <button
          disabled={busy !== null}
          onClick={regenerate}
          className="rounded-lg border border-line px-5 py-3.5 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          {busy === "regenerating" ? "Writing new ads…" : "Regenerate"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      {busy === "regenerating" && (
        <p className="mt-2 text-center text-xs text-ink-faint">
          Throwing these out and writing you a fresh pair. This takes a moment.
        </p>
      )}
      <p className="mt-3 text-center text-xs text-ink-faint">
        Nothing spends until you approve, and every ad goes up paused first.
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
