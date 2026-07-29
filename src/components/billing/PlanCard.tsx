import Link from "next/link";
import { isPaid, planSummary, type PlanState } from "@/lib/billing/plan";

/**
 * Plan / upgrade card (Phase 4 prep). Shows the freemium state and the upgrade
 * path. The free tier gets one render then this becomes the paywall; upgrading
 * itself opens when Phase-4 payments go live (the CTA points at the wallet,
 * where the subscription will live).
 */
export function PlanCard({ state }: { state: PlanState }) {
  const paid = isPaid(state);

  return (
    <div
      className={`rounded-card border p-5 ${
        paid ? "border-line bg-surface-raised" : "border-accent/40 bg-accent-soft"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="datalabel">plan</div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${
            paid ? "bg-surface-overlay text-ink-muted" : "bg-accent text-white"
          }`}
        >
          {paid ? "full" : "free"}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink">{planSummary(state)}</p>

      {!paid && (
        <>
          <ul className="mt-3 flex flex-col gap-1 text-xs text-ink-muted">
            <li>✓ Ad concepts, unlimited</li>
            <li>{state.freeRenderUsed ? "✕ Your one free render is used" : "✓ One free render"}</li>
            <li>✕ Video renders, more renders, launching real ads</li>
          </ul>
          <Link
            href="/wallet"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            Upgrade to the full plan
          </Link>
          <p className="mt-2 text-xs text-ink-faint">
            Upgrading opens once payments go live. It unlocks video, unlimited renders, and running
            your ads for real.
          </p>
        </>
      )}
    </div>
  );
}
