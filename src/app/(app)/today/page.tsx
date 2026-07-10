import { AgentNote } from "@/components/ui/AgentNote";
import { MetricChip } from "@/components/ui/MetricChip";

/**
 * Today — the dashboard home (UI Plan §3).
 * Pre-funding this renders in preview mode: real layout, empty-state data,
 * every card nudging toward the first wallet top-up (UF-1 branch).
 */
export default function TodayPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <div className="datalabel">today</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Good evening<span className="text-accent-bright">.</span>
        </h1>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricChip label="spend today" value="$0.00" hint="No live campaigns yet" />
        <MetricChip label="impressions" value="—" />
        <MetricChip label="conversion intents" value="—" hint="WhatsApp opens · calls · visits" />
        <MetricChip label="verified sales" value="—" hint="Connect your store to unlock" />
      </section>

      <section className="mt-6">
        <AgentNote>
          I&apos;m ready when you are. Fund your wallet and upload your first product
          photo — I&apos;ll study the top ads in your niche, build your 50-concept
          pipeline, and have tomorrow&apos;s first two ads waiting for your approval
          by this evening.
        </AgentNote>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">the duel</div>
          <p className="mt-3 text-sm text-ink-muted">
            No test running. Once you&apos;re live, your champion ad and two fresh
            challengers compete here every day — winners are only declared after
            24 hours and 5,000 impressions.
          </p>
          <div className="mt-4 flex gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-surface-overlay" />
            <div className="h-1.5 flex-1 rounded-full bg-surface-overlay" />
            <div className="h-1.5 flex-1 rounded-full bg-surface-overlay" />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">wallet</div>
          <div className="mt-2 font-mono text-2xl font-semibold">$0.00</div>
          <p className="mt-2 text-xs text-ink-faint">
            Minimum to go live: 7 days of your daily budget (from $70 at $10/day).
          </p>
          <button className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright">
            Add funds
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <div className="datalabel">concept pipeline</div>
          <span className="datalabel">0 / 50</span>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          After onboarding, the research agent reverse-engineers the most viral
          ads in your niche into 50 ranked, scripted concepts. Only the two
          entering each day&apos;s duel are rendered — you always see what&apos;s
          coming next.
        </p>
      </section>
    </div>
  );
}
