import Link from "next/link";
import { AgentNote } from "@/components/ui/AgentNote";
import { MetricChip } from "@/components/ui/MetricChip";
import { createClient } from "@/lib/supabase/server";
import { fetchUsdRate } from "@/lib/money/rates";
import { currencyForCountry } from "@/lib/money/currency";
import { fmtDual, fmtRoas, fmtUsd } from "@/lib/money/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

const PIPELINE_TARGET = 50;

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, daily_budget_usd_minor, country, currency")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="datalabel">today</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Let&apos;s set you up</h1>
        <p className="mt-4 text-sm text-ink-muted">
          Finish onboarding and the agent starts building your ads tonight.
        </p>
        <Link
          href="/onboarding"
          className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
        >
          Start onboarding
        </Link>
      </div>
    );
  }

  const bizId = business.id as string;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { data: wallet } = await supabase
    .from("wallet_balances")
    .select("wallet_id, balance_usd_minor")
    .eq("business_id", bizId)
    .maybeSingle();
  const walletId = wallet?.wallet_id as string | undefined;
  const balanceUsdMinor = Number(wallet?.balance_usd_minor ?? 0);

  const [conceptsRes, salesRes, spendRes, clicksRes, approvalRes, testRes] = await Promise.all([
    supabase.from("concepts").select("id", { count: "exact", head: true }).eq("business_id", bizId),
    supabase.from("conversions").select("value_usd_minor").eq("business_id", bizId).gte("created_at", todayIso),
    walletId
      ? supabase.from("ledger_entries").select("amount_usd_minor").eq("wallet_id", walletId).eq("kind", "ad_spend").gte("created_at", todayIso)
      : Promise.resolve({ data: [] as { amount_usd_minor: number }[] }),
    supabase
      .from("click_events")
      .select("id, smart_links!inner(business_id)", { count: "exact", head: true })
      .eq("smart_links.business_id", bizId)
      .gte("created_at", todayIso),
    supabase.from("approvals").select("plan_date").eq("business_id", bizId).eq("status", "awaiting").order("plan_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ab_tests").select("status, test_date").eq("business_id", bizId).order("test_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const pipelineCount = conceptsRes.count ?? 0;
  const salesTodayUsdMinor = (salesRes.data ?? []).reduce((s, r) => s + Number(r.value_usd_minor ?? 0), 0);
  const spendTodayUsdMinor = Math.abs((spendRes.data ?? []).reduce((s, r) => s + Number(r.amount_usd_minor ?? 0), 0));
  const clicksToday = clicksRes.count ?? 0;
  const awaiting = approvalRes.data;
  const duelRunning = testRes.data?.status === "pending";

  // Local currency for the aside (USD stays the anchor).
  const currency = (business.currency as string) ?? "USD";
  let local: { rate: number; symbol: string; currency: string } | null = null;
  if (currency !== "USD") {
    try {
      const snap = await fetchUsdRate(currency);
      local = { rate: snap.rate, symbol: currencyForCountry(business.country as string).symbol, currency };
    } catch {
      /* no local aside if the rate is unavailable */
    }
  }

  const agentLine = awaiting
    ? `Tomorrow's plan is ready, review the two new ads and approve when you're happy.`
    : pipelineCount > 0
      ? `Your pipeline has ${pipelineCount} concepts. Fund your wallet and I'll launch the first duel this evening.`
      : `I'm ready when you are. Fund your wallet and upload a product photo, I'll study the top ads in your niche and have tomorrow's first two waiting for approval.`;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <div className="datalabel">today · {business.name}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Good evening<span className="text-accent-bright">.</span>
        </h1>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricChip label="spend today" value={fmtDual(spendTodayUsdMinor, local)} hint={duelRunning ? "live" : "no live campaigns yet"} />
        <MetricChip label="link clicks" value={clicksToday > 0 ? clicksToday.toLocaleString() : "—"} hint="taps through your ads" />
        <MetricChip label="verified sales" value={salesTodayUsdMinor > 0 ? fmtDual(salesTodayUsdMinor, local) : "—"} hint="today" />
        <MetricChip label="return on spend" value={fmtRoas(salesTodayUsdMinor, spendTodayUsdMinor)} hint="sales ÷ spend" />
      </section>

      <section className="mt-6">
        {awaiting ? (
          <AgentNote>
            {agentLine}{" "}
            <Link href="/approve" className="text-accent underline hover:text-accent-bright">
              Review tonight&apos;s plan →
            </Link>
          </AgentNote>
        ) : (
          <AgentNote>{agentLine}</AgentNote>
        )}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Link href="/duel" className="block rounded-card border border-line bg-surface-raised p-5 transition-colors hover:border-ink-faint">
          <div className="datalabel">the duel</div>
          <p className="mt-3 text-sm text-ink-muted">
            {duelRunning
              ? "A duel is running: your champion and two challengers are competing. Open it for the live scoreboard."
              : "No test running yet. Once you're live, your champion and two fresh challengers compete here every day, judged after 24 hours and 5,000 impressions."}
          </p>
        </Link>

        <div className="rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">wallet</div>
          <div className="mt-2 font-mono text-2xl font-semibold">{fmtUsd(balanceUsdMinor)}</div>
          {local && balanceUsdMinor > 0 && (
            <div className="mt-0.5 font-mono text-xs text-ink-faint">{fmtDual(balanceUsdMinor, local).replace(/^[^(]*\(/, "≈ ").replace(/\)$/, "")}</div>
          )}
          <p className="mt-2 text-xs text-ink-faint">
            To go live we hold 7 days of your budget, so ${(business.daily_budget_usd_minor as number) / 100 * 7} at your current rate.
          </p>
          <Link href="/wallet" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright">
            {balanceUsdMinor > 0 ? "Manage wallet" : "Add funds"}
          </Link>
        </div>
      </section>

      <Link href="/pipeline" className="mt-6 block rounded-card border border-line bg-surface-raised p-5 transition-colors hover:border-ink-faint">
        <div className="flex items-center justify-between">
          <div className="datalabel">concept pipeline</div>
          <span className="datalabel">{pipelineCount} / {PIPELINE_TARGET}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-overlay">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (pipelineCount / PIPELINE_TARGET) * 100)}%` }} />
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          {pipelineCount === 0
            ? "After onboarding, the research agent reverse-engineers the most viral ads in your niche into 50 ranked, scripted concepts."
            : `${pipelineCount} scripted concepts ready. Only the two entering each day's duel are rendered, you always see what's coming next.`}
        </p>
      </Link>
    </div>
  );
}
