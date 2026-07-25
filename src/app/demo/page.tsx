import Link from "next/link";
import type { Metadata } from "next";
import { AgentNote } from "@/components/ui/AgentNote";
import { MetricChip } from "@/components/ui/MetricChip";

/**
 * Public "take a tour" demo (Phase 3, decision D1). A read-only sample account
 * showing exactly what the dashboard looks like once the agent is running —
 * believable numbers, a live duel, verified sales, real activity — with no auth
 * and no wallet. Shareable before signup. All data here is hardcoded fiction.
 */
export const metadata: Metadata = {
  title: "See it in action — Glocal",
  description: "A live look at an autonomous ad account, running on its own.",
};

const DUEL = [
  { name: "Champion", tag: "holding the crown", roas: "13.4×", ctr: "3.1%", spend: "$18.00", winner: true },
  { name: "Challenger A", tag: "fresh angle", roas: "9.8×", ctr: "2.4%", spend: "$15.00", winner: false },
  { name: "Challenger B", tag: "new hook", roas: "6.2×", ctr: "1.7%", spend: "$15.00", winner: false },
];

const ACTIVITY = [
  { text: "Judged yesterday's duel — Challenger A dethroned the champion", time: "2h" },
  { text: "Launched today's two challengers on Meta", time: "5h" },
  { text: "Rendered new creatives from your product photo", time: "6h" },
  { text: "Added 6 fresh concepts to your pipeline", time: "9h" },
  { text: "Verified a $54.00 sale and tied it to Challenger A", time: "11h" },
  { text: "Compliance-checked a concept before it went live", time: "14h" },
];

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Demo banner */}
      <div className="border-b border-line bg-accent-soft px-6 py-2.5 text-center text-sm text-ink">
        <span className="datalabel text-accent-bright">demo</span>{" "}
        <span className="ml-2">Sample account — this is what your dashboard looks like once the agent is running.</span>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex items-end justify-between">
          <div>
            <div className="datalabel">today · Ada&apos;s Skincare</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Good evening<span className="text-accent-bright">.</span>
            </h1>
          </div>
          <Link
            href="/signup"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            Start free
          </Link>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricChip label="spend today" value="$48.00" hint="live" trend="flat" />
          <MetricChip label="link clicks" value="1,284" hint="taps through your ads" trend="up" />
          <MetricChip label="verified sales" value="$612.40" hint="today" trend="up" />
          <MetricChip label="return on spend" value="12.8×" hint="sales ÷ spend" trend="up" />
        </section>

        <section className="mt-6">
          <AgentNote time="2h">
            Good news — Challenger A just beat your champion on return on spend, so I&apos;ve crowned it
            and lined up two fresh challengers for tonight. You don&apos;t need to do anything.
          </AgentNote>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-line bg-surface-raised p-5">
            <div className="flex items-center justify-between">
              <div className="datalabel">the duel</div>
              <span className="datalabel">live · 5,000 impressions</span>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {DUEL.map((d) => (
                <div
                  key={d.name}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
                    d.winner ? "border-accent bg-accent-soft" : "border-line bg-surface"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {d.name}
                      {d.winner && <span className="ml-2 text-xs text-accent-bright">winning</span>}
                    </div>
                    <div className="datalabel mt-0.5">{d.tag}</div>
                  </div>
                  <div className="flex gap-4 text-right font-mono text-xs text-ink-muted">
                    <div>
                      <div className="text-ink">{d.roas}</div>
                      <div className="text-ink-faint">roas</div>
                    </div>
                    <div>
                      <div className="text-ink">{d.ctr}</div>
                      <div className="text-ink-faint">ctr</div>
                    </div>
                    <div>
                      <div className="text-ink">{d.spend}</div>
                      <div className="text-ink-faint">spend</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">wallet</div>
            <div className="mt-2 font-mono text-2xl font-semibold">$326.00</div>
            <div className="mt-0.5 font-mono text-xs text-ink-faint">≈ 6.8 days of runway at $48/day</div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-overlay">
              <div className="h-full rounded-full bg-accent" style={{ width: "68%" }} />
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              The agent tops out at your daily budget and warns you here long before funds run low.
            </p>
          </div>
        </section>

        <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
          <div className="flex items-center justify-between">
            <div className="datalabel">concept pipeline</div>
            <span className="datalabel">50 / 50</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-overlay">
            <div className="h-full rounded-full bg-accent" style={{ width: "100%" }} />
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            50 scripted concepts ready, reverse-engineered from the best-performing ads in skincare.
            Only the two entering each day&apos;s duel get rendered — you always see what&apos;s coming next.
          </p>
        </div>

        <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">activity</div>
          <ul className="mt-3 flex flex-col">
            {ACTIVITY.map((e, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <p className="flex-1 text-sm text-ink">{e.text}</p>
                <span className="shrink-0 font-mono text-xs text-ink-faint">{e.time}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-card border border-line bg-surface-raised p-8 text-center">
          <h2 className="text-xl font-semibold tracking-tight">This runs while you run your business.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            Set a budget once. The agent researches, writes, launches, tests, and doubles down on what
            sells — and shows you every move in plain language.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Start free
            </Link>
            <Link href="/" className="rounded-lg border border-line px-6 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink">
              Back to home
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
