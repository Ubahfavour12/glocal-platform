import { notFound, redirect } from "next/navigation";
import { GlocalMark } from "@/components/brand/Logo";
import { Dot, Empty, Event, Panel, Pill, Stat, type Tone } from "@/components/ops/Console";
import { createServiceClient } from "@/lib/supabase/server";
import { microsToUsdMinor } from "@/lib/ai/cost";
import { checkOpsGate } from "@/lib/admin/gate";
import { funnel, walletFloatUsdMinor, worstDrop } from "@/lib/admin/funnel";
import { subscriptionPriceUsdMinor } from "@/lib/billing/subscribe";
import { isTierId } from "@/lib/billing/subscription";
import {
  EXCLUDED_FROM_MARGIN,
  economicsTotals,
  infraShareUsdMinor,
  rankByMargin,
  type CustomerCosts,
} from "@/lib/admin/economics";
import {
  HEALTH_LABEL,
  health,
  rankCustomers,
  totals,
  type CustomerRow,
} from "@/lib/admin/overview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Founder console" };

const usd = (minor: number) =>
  `${minor < 0 ? "−" : ""}$${(Math.abs(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso: string | null) => {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
};

/** Open far longer than a refund should take. Module scope, like `when`, so it
 *  is not an impure call inside the render body. */
const STUCK_AFTER_DAYS = 3;

/** Hours since an instant. Module scope for the same reason as isStuck. */
function hoursSince(iso: string | null): number {
  return iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : Infinity;
}
function isStuck(status: string, requestedAt: string): boolean {
  if (status !== "requested") return false;
  return Date.now() - new Date(requestedAt).getTime() > STUCK_AFTER_DAYS * 86_400_000;
}


/**
 * The founder console — every customer, wallet, plan and error in one view.
 *
 * Reads through the SERVICE ROLE, which bypasses row-level security. That is
 * the point (no other page can see across customers) and also the risk, so
 * access is checked first, before a single service-role query is built, and a
 * refusal is a 404 rather than a 403: a stranger learns nothing about whether
 * the page exists.
 *
 * Ordered by what needs attention, not by signup date. During the dogfood the
 * useful question is "who is stuck?", and a paying customer with money who is
 * somehow not running ads is the most expensive row on the screen.
 */
export default async function OpsPage() {
  // TWO LOCKS, and the second one is the new part. The magic-link session
  // proves which email signed in; the authenticator code proves whoever is
  // here also holds the phone. Until that second lock existed, a compromised
  // inbox was a compromised customer book.
  const gate = await checkOpsGate();
  if (!gate.ok) {
    // Someone allowlisted who simply has not entered a code yet gets the
    // prompt. Everybody else gets a 404 and learns nothing -- not that the
    // page exists, not that they were close.
    if (gate.reason === "needs_code") redirect("/ops/unlock");
    if (gate.reason === "needs_enrolment") redirect("/ops/enrol");
    notFound();
  }

  const svc = createServiceClient();

  const [
    bizRes,
    walletRes,
    adsRes,
    journalRes,
    wdRes,
    creativeRes,
    subRes,
    markupRes,
    walletIdRes,
    llmRes,
    feeRes,
    progressRes,
    adAcctRes,
    socialRes2,
    errorRes,
  ] =
    await Promise.all([
    svc
      .from("businesses")
      .select("id, name, plan, currency, daily_budget_usd_minor, owner_id, created_at")
      .order("created_at", { ascending: false }),
    svc.from("wallet_balances").select("business_id, balance_usd_minor"),
    svc.from("ads").select("id, business_id, status").eq("status", "live"),
    svc
      .from("journal_entries")
      .select("business_id, entry_type, content, created_at")
      .order("created_at", { ascending: false })
      .limit(400),
    // Money leaving the platform. Shown whatever its state, because a
    // withdrawal that is quietly stuck is the worst kind: the customer is out
    // of pocket and nothing anywhere is complaining.
    svc
      .from("withdrawals")
      .select("id, business_id, amount_usd_minor, status, requested_at, settled_at, note")
      .order("requested_at", { ascending: false })
      .limit(50),
    // What serving each customer costs us. Recorded per creative since 0020;
    // never added up until now, which is how "the markup IS the business model"
    // and "we do not know our cost per customer" coexisted.
    svc.from("creatives").select("business_id, render_cost_usd_minor"),
    svc.from("subscriptions").select("business_id, tier, active"),
    svc.from("ledger_entries").select("wallet_id, kind, amount_usd_minor").eq("kind", "markup_fee"),
    svc.from("wallets").select("id, business_id"),
    // The two costs that were measured nowhere until now. Without them this
    // page computed margin as revenue minus RENDERS and called it the margin.
    svc.from("llm_usage").select("business_id, cost_usd_micros"),
    svc.from("payment_fees").select("business_id, fee_usd_minor"),
    // Unhandled server errors, grouped. Until this existed, a production
    // exception went to stdout and no further -- the first you heard of one
    // was a customer telling you.
    svc.from("businesses").select("id, category, destination, last_run_at"),
    svc.from("ad_accounts").select("business_id"),
    svc.from("social_connections").select("business_id").eq("status", "active"),
    svc
      .from("error_events")
      .select("fingerprint, message, route, route_type, seen_count, first_seen_at, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(12),
  ]);

  const businesses = bizRes.data ?? [];

  // auth.users is not exposed through PostgREST, so owner emails come from the
  // admin API. Paged because listUsers caps per call, and a missing email is
  // shown as unknown rather than failing the whole page.
  const emails = new Map<string, string>();
  try {
    const { data: userList } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of userList?.users ?? []) if (u.email) emails.set(u.id, u.email);
  } catch {
    // Non-fatal: the console is still useful without addresses.
  }

  const balances = new Map<string, number>(
    (walletRes.data ?? []).map((w) => [w.business_id as string, Number(w.balance_usd_minor ?? 0)]),
  );
  const liveAds = new Map<string, number>();
  for (const a of adsRes.data ?? []) {
    const k = a.business_id as string;
    liveAds.set(k, (liveAds.get(k) ?? 0) + 1);
  }
  const lastSeen = new Map<string, string>();
  for (const j of journalRes.data ?? []) {
    const k = j.business_id as string;
    if (!lastSeen.has(k)) lastSeen.set(k, j.created_at as string);
  }

  const rows: CustomerRow[] = businesses.map((b) => ({
    businessId: b.id as string,
    name: (b.name as string) ?? "—",
    ownerEmail: emails.get(b.owner_id as string) ?? null,
    plan: (b.plan as string) ?? "free",
    currency: (b.currency as string) ?? "USD",
    balanceUsdMinor: balances.get(b.id as string) ?? 0,
    dailyBudgetUsdMinor: Number(b.daily_budget_usd_minor ?? 0),
    liveAds: liveAds.get(b.id as string) ?? 0,
    lastActivityAt: lastSeen.get(b.id as string) ?? null,
    createdAt: b.created_at as string,
  }));

  const ranked = rankCustomers(rows);
  const t = totals(rows);

  const problems = (journalRes.data ?? [])
    .filter((j) => /fail|error|skip|reject|insufficient|awaiting/i.test(String(j.entry_type)))
    .slice(0, 25);
  const nameOf = new Map(rows.map((r) => [r.businessId, r.name]));
  const withdrawals = wdRes.data ?? [];

  // Render cost and render count per business.
  const renderCost = new Map<string, { usdMinor: number; count: number }>();
  for (const c of creativeRes.data ?? []) {
    const k = c.business_id as string;
    const prev = renderCost.get(k) ?? { usdMinor: 0, count: 0 };
    renderCost.set(k, {
      usdMinor: prev.usdMinor + Number(c.render_cost_usd_minor ?? 0),
      count: prev.count + 1,
    });
  }
  const subs = new Map<string, { tier: string; active: boolean }>(
    (subRes.data ?? []).map((r) => [
      r.business_id as string,
      { tier: (r.tier as string) ?? "free", active: Boolean(r.active) },
    ]),
  );
  // Markup is recorded against a wallet, so it needs the wallet→business hop.
  const walletOwner = new Map<string, string>(
    (walletIdRes.data ?? []).map((w) => [w.id as string, w.business_id as string]),
  );
  const markup = new Map<string, number>();
  for (const e of markupRes.data ?? []) {
    const biz = walletOwner.get(e.wallet_id as string);
    if (!biz) continue;
    // Markup is a debit on the customer's wallet, so it is stored negative.
    // Revenue to us is its magnitude.
    markup.set(biz, (markup.get(biz) ?? 0) + Math.abs(Number(e.amount_usd_minor ?? 0)));
  }

  // LLM spend is stored in MICRO-dollars, because a single Haiku call rounds
  // to zero cents and a month of zeros is how a team concludes the LLM is
  // free. Summed in micros and converted once, here, where the number is
  // finally large enough for a cent to mean something.
  const llmMicros = new Map<string, number>();
  for (const u of llmRes.data ?? []) {
    const k = u.business_id as string;
    llmMicros.set(k, (llmMicros.get(k) ?? 0) + Number(u.cost_usd_micros ?? 0));
  }
  const processingFee = new Map<string, number>();
  for (const f of feeRes.data ?? []) {
    const k = f.business_id as string;
    processingFee.set(k, (processingFee.get(k) ?? 0) + Number(f.fee_usd_minor ?? 0));
  }
  // Everyone alive carries an equal slice of the fixed bill.
  const infraEach = infraShareUsdMinor(rows.length);

  const costRows: CustomerCosts[] = rows.map((r) => ({
    businessId: r.businessId,
    name: r.name,
    tier: r.plan,
    renderCostUsdMinor: renderCost.get(r.businessId)?.usdMinor ?? 0,
    renderCount: renderCost.get(r.businessId)?.count ?? 0,
    markupRevenueUsdMinor: markup.get(r.businessId) ?? 0,
    subscribed: subs.get(r.businessId)?.active ?? false,
    llmCostUsdMinor: microsToUsdMinor(llmMicros.get(r.businessId) ?? 0),
    processingFeeUsdMinor: processingFee.get(r.businessId) ?? 0,
    infraShareUsdMinor: infraEach,
  }));
  /*
   * WHERE EVERYONE STOPS.
   *
   * The console could answer "who is stuck?" a row at a time and could not
   * answer "where does everyone get stuck?" at all. Those are different
   * questions and only the second says what to build next -- 315 plans
   * written, 544 compliance checks passed, zero ads launched, all stopping at
   * the same step.
   */
  const withAdAccount = new Set(
    (adAcctRes.data ?? []).map((r) => String(r.business_id)),
  );
  const withSocial = new Set((socialRes2.data ?? []).map((r) => String(r.business_id)));

  const fundedEver = new Set<string>();
  for (const [bizId, amount] of markup) if (amount > 0) fundedEver.add(bizId);
  for (const r of rows) if ((r.balanceUsdMinor ?? 0) > 0) fundedEver.add(r.businessId);
  const launchedEver = new Set(
    (adsRes.data ?? []).map((a) => String((a as { business_id?: string }).business_id ?? "")),
  );
  const steps = funnel(
    (progressRes.data ?? []).map((b) => {
      const id = String(b.id);
      return {
        businessId: id,
        onboarded: Boolean(b.category) && Boolean(b.destination),
        connected: withAdAccount.has(id) || withSocial.has(id),
        funded: fundedEver.has(id),
        launched: launchedEver.has(id),
      };
    }),
  );
  const wall = worstDrop(steps);

  // Money being held that is NOT ours. Shown apart from revenue and never
  // added to it: treating customer float as income is the one accounting
  // mistake here that would actually hurt.
  const floatUsdMinor = walletFloatUsdMinor([...balances.values()]);

  // Monthly recurring revenue, from the plans actually active right now.
  const mrrUsdMinor = [...subs.values()]
    .filter((x) => x.active && isTierId(x.tier))
    .reduce((t, x) => t + subscriptionPriceUsdMinor(x.tier as "spark" | "growth" | "scale"), 0);

  // Did the agent actually run last night? Nothing showed this before.
  const lastRuns = (progressRes.data ?? [])
    .map((b) => (b.last_run_at ? Date.parse(String(b.last_run_at)) : NaN))
    .filter((n) => Number.isFinite(n));
  const newestRun = lastRuns.length > 0 ? new Date(Math.max(...lastRuns)).toISOString() : null;
  const stalestRun = lastRuns.length > 0 ? new Date(Math.min(...lastRuns)).toISOString() : null;

  const margins = rankByMargin(costRows).filter((m) => m.costUsdMinor > 0 || m.revenueUsdMinor > 0);
  const econ = economicsTotals(costRows);

  // ---- read-outs the panels share ----
  const widest = steps[0]?.count || 1;
  const errors = errorRes.data ?? [];
  const stuckWithdrawals = withdrawals.filter((w) => isStuck(String(w.status), w.requested_at as string));
  const openWithdrawals = withdrawals.filter((w) => String(w.status) === "requested");
  const runHoursAgo = hoursSince(newestRun);
  const agentTone: Tone = runHoursAgo <= 26 ? "positive" : runHoursAgo <= 50 ? "accent" : "negative";
  const allClear = errors.length === 0 && stuckWithdrawals.length === 0 && agentTone === "positive";
  const costParts = [
    { k: "Renders", v: econ.renderCostUsdMinor, c: "bg-[#f58510]" },
    { k: "LLM", v: econ.llmCostUsdMinor, c: "bg-[#a5b4fc]" },
    { k: "Fees", v: econ.processingFeeUsdMinor, c: "bg-[#fb7185]" },
    { k: "Infrastructure", v: econ.infraShareUsdMinor, c: "bg-[#80808a]" },
  ];
  const costTotal = costParts.reduce((a, b) => a + b.v, 0) || 1;
  const maxWallet = Math.max(1, ...ranked.map((r) => r.balanceUsdMinor));
  const HEALTH_TONE: Record<string, Tone> = {
    spending: "positive",
    ready: "accent",
    empty_wallet: "negative",
    free: "neutral",
    onboarding: "indigo",
  };

  return (
    <div className="mx-auto max-w-7xl">
      {/* ---- command bar ---- */}
      <div className="gl-glass sticky top-3 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line px-4 py-3 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2.5">
          <GlocalMark className="h-6 w-6 shrink-0 text-ink" title="Glocal" />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            glocal<span className="text-accent-bright">.</span>
          </span>
          <span className="rounded-md border border-[var(--lit-edge)] bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-accent-bright">
            OPS
          </span>
        </div>
        <div className="hidden h-5 w-px bg-line sm:block" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] tracking-[0.04em] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Dot tone={agentTone} pulse={agentTone !== "positive"} />
            agent {newestRun ? when(newestRun) : "never ran"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot tone={errors.length ? "negative" : "positive"} pulse={errors.length > 0} />
            {errors.length} {errors.length === 1 ? "fault" : "faults"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot tone={stuckWithdrawals.length ? "negative" : openWithdrawals.length ? "accent" : "positive"} />
            {openWithdrawals.length} refunds open
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-faint">
          <span className="gl-orb h-1.5 w-1.5 rounded-full" />
          <span className="hidden sm:inline">2FA verified ·</span> {gate.email}
        </div>
      </div>

      {/* ---- masthead ---- */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="ops-label">founder console · live read across every customer</div>
          <h1 className="gl-title mt-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.045em] sm:text-[44px]">
            Mission control
          </h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
            Every customer, wallet and fault in one view, ordered by what needs you first.
          </p>
        </div>
        <Pill tone={allClear ? "positive" : "accent"}>
          {allClear ? "ALL SYSTEMS NOMINAL" : "ATTENTION NEEDED"}
        </Pill>
      </div>

      {/* ---- headline read-outs ---- */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="MRR" value={usd(mrrUsdMinor)} note={`${t.paying} paying`} tone="accent" />
        <Stat
          label="Customers"
          value={String(t.customers)}
          note={`${t.running} running ads`}
          tone="indigo"
          bar={t.customers ? t.running / t.customers : 0}
        />
        <Stat
          label="Customer float"
          value={usd(floatUsdMinor)}
          note="Held for customers. Not revenue."
          tone="neutral"
        />
        <Stat
          label="Revenue − costs"
          value={usd(econ.marginUsdMinor)}
          note={econ.underwaterCount ? `${econ.underwaterCount} customers underwater` : "nobody underwater"}
          tone={econ.marginUsdMinor < 0 || econ.underwaterCount ? "negative" : "positive"}
        />
      </div>

      {/* ---- funnel + system ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Panel
          label="conversion · where customers stop"
          title={wall ? `The wall is at ${wall.label.toLowerCase()}` : "Nobody has started yet"}
          aside={wall ? <Pill tone="negative">−{wall.droppedFromPrevious} lost here</Pill> : undefined}
        >
          <div className="flex flex-col gap-3">
            {steps.map((step, i) => {
              const pct = Math.round((step.count / widest) * 100);
              const isWall = wall?.key === step.key;
              return (
                <div key={step.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2.5 text-ink-muted">
                      <span className="font-mono text-[11px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                      <span className={isWall ? "text-ink" : ""}>{step.label}</span>
                    </span>
                    <span className="font-mono text-ink">
                      {step.count}
                      <span className="ml-2 text-[11px] text-ink-faint">{pct}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-overlay">
                    <div
                      className={`h-full rounded-full ${
                        isWall
                          ? "ops-scan bg-gradient-to-r from-[#e11d48] to-[#fb7185] shadow-[0_0_14px_rgba(251,113,133,0.7)]"
                          : "bg-gradient-to-r from-[#e5730a] to-[#ffa54d] shadow-[0_0_12px_rgba(245,133,16,0.55)]"
                      }`}
                      style={{ width: `${Math.max(pct, step.count ? 2 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {wall && (
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">
              {wall.droppedFromPrevious} of {steps[0].count} never get past{" "}
              <span className="text-ink">{wall.label.toLowerCase()}</span>. Fix this before anything
              else on the page.
            </p>
          )}
        </Panel>

        <Panel label="systems" title="Is everything running?">
          <ul className="flex flex-col divide-y divide-[var(--line-soft)]">
            {[
              {
                k: "Nightly agent",
                v: newestRun ? `ran ${when(newestRun)}` : "never ran",
                tone: agentTone,
              },
              {
                k: "Longest unserved",
                v: stalestRun ? when(stalestRun) : "nobody yet",
                tone: (stalestRun && hoursSince(stalestRun) > 50
                  ? "negative"
                  : "positive") as Tone,
              },
              {
                k: "Server faults",
                v: errors.length ? `${errors.length} distinct` : "none",
                tone: (errors.length ? "negative" : "positive") as Tone,
              },
              {
                k: "Refunds",
                v: stuckWithdrawals.length
                  ? `${stuckWithdrawals.length} stuck`
                  : openWithdrawals.length
                    ? `${openWithdrawals.length} in flight`
                    : "none open",
                tone: (stuckWithdrawals.length ? "negative" : openWithdrawals.length ? "accent" : "positive") as Tone,
              },
              {
                k: "Money held",
                v: usd(t.walletUsdMinor),
                tone: "neutral" as Tone,
              },
            ].map((row) => (
              <li key={row.k} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2.5 text-sm text-ink-muted">
                  <Dot tone={row.tone} pulse={row.tone === "negative"} />
                  {row.k}
                </span>
                <span className="font-mono text-sm text-ink">{row.v}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* ---- customers ---- */}
      <Panel
        className="mt-4"
        label="customers · ordered by who needs you"
        title={`${t.customers} businesses`}
        aside={
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="positive">{t.running} spending</Pill>
            <Pill tone="accent">{t.paying} paying</Pill>
          </div>
        }
      >
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="border-y border-line-soft">
                {["Business", "State", "Plan", "Wallet", "Budget/day", "Live ads", "Last active"].map((h) => (
                  <th key={h} className="ops-label px-5 py-2.5 font-normal sm:px-6">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => {
                const h = health(r);
                return (
                  <tr
                    key={r.businessId}
                    className="border-b border-line-soft transition-colors last:border-0 hover:bg-[rgba(255,255,255,0.025)]"
                  >
                    <td className="px-5 py-3 sm:px-6">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-overlay font-mono text-xs text-ink-muted">
                          {r.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{r.name}</span>
                          <span className="block truncate font-mono text-[11px] text-ink-faint">
                            {r.ownerEmail ?? "unknown email"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <Pill tone={HEALTH_TONE[h] ?? "neutral"}>{HEALTH_LABEL[h]}</Pill>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-ink-muted sm:px-6">
                      {r.plan}
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <div className="font-mono text-ink">{usd(r.balanceUsdMinor)}</div>
                      <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-overlay">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.round((r.balanceUsdMinor / maxWallet) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-ink-muted sm:px-6">{usd(r.dailyBudgetUsdMinor)}</td>
                    <td className="px-5 py-3 font-mono sm:px-6">
                      <span className={r.liveAds ? "text-positive" : "text-ink-faint"}>{r.liveAds}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-faint sm:px-6">{when(r.lastActivityAt)}</td>
                  </tr>
                );
              })}
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-ink-faint">
                    No businesses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---- unit economics ---- */}
      <Panel
        className="mt-4"
        label="unit economics · cost to serve"
        title="What each customer costs, worst first"
        aside={
          <div className="text-right">
            <div className="font-mono text-lg text-ink">{usd(econ.revenueUsdMinor)}</div>
            <div className="ops-label">revenue</div>
          </div>
        }
      >
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-overlay">
          {costParts.map((c) => (
            <div key={c.k} className={c.c} style={{ width: `${(c.v / costTotal) * 100}%` }} title={`${c.k} ${usd(c.v)}`} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {costParts.map((c) => (
            <div key={c.k} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-ink-muted">
                <span className={`h-2 w-2 rounded-sm ${c.c}`} />
                {c.k}
              </span>
              <span className="font-mono text-ink">{usd(c.v)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-line-soft pt-4">
          <div>
            <div className="ops-label">cost to serve</div>
            <div className="mt-1 font-mono text-lg text-ink">{usd(econ.costUsdMinor)}</div>
          </div>
          <div>
            <div className="ops-label">revenue − these costs</div>
            <div className={`mt-1 font-mono text-lg ${econ.marginUsdMinor < 0 ? "text-negative" : "text-positive"}`}>
              {usd(econ.marginUsdMinor)}
            </div>
          </div>
          <div>
            <div className="ops-label">underwater</div>
            <div className="mt-1 font-mono text-lg text-ink">{econ.underwaterCount}</div>
          </div>
        </div>
        {margins.length === 0 ? (
          <div className="mt-4">
            <Empty>Nothing rendered and nothing charged yet.</Empty>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {margins.map((m) => {
              const scale = Math.max(m.costUsdMinor, m.revenueUsdMinor, 1);
              return (
                <li key={m.businessId} className="rounded-xl border border-line-soft px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{m.name}</span>
                    <span className={`font-mono text-sm ${m.underwater ? "text-negative" : "text-positive"}`}>
                      {m.underwater ? "costs more than they pay" : usd(m.marginUsdMinor)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint">
                    <span>pays</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                      <span className="block h-full rounded-full bg-positive" style={{ width: `${(m.revenueUsdMinor / scale) * 100}%` }} />
                    </span>
                    <span>costs</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                      <span className="block h-full rounded-full bg-negative" style={{ width: `${(m.costUsdMinor / scale) * 100}%` }} />
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-ink-faint">
                    {usd(m.costUsdMinor)} to serve · pays {usd(m.revenueUsdMinor)}
                    {m.biggestCost ? ` · mostly ${m.biggestCost}` : ""} · {m.renderCount} render
                    {m.renderCount === 1 ? "" : "s"}
                    {m.llmCostUsdMinor > 0 ? ` · llm ${usd(m.llmCostUsdMinor)}` : ""}
                    {m.processingFeeUsdMinor > 0 ? ` · fees ${usd(m.processingFeeUsdMinor)}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Still excluded: {EXCLUDED_FROM_MARGIN.join(", ")}. Infrastructure is an allocation of a fixed
          monthly bill, not a measurement. Render and LLM rates are list prices, not invoices.
        </p>
      </Panel>

      {/* ---- event streams ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel
          label="faults"
          title="Server errors"
          aside={<Pill tone={errors.length ? "negative" : "positive"}>{errors.length || "clear"}</Pill>}
        >
          {errors.length === 0 ? (
            <Empty>Nothing has thrown.</Empty>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {errors.map((e) => (
                <Event
                  key={String(e.fingerprint)}
                  tone="negative"
                  who=""
                  what={`${String(e.message)} ×${Number(e.seen_count ?? 1)}`}
                  when={when(e.last_seen_at as string | null)}
                  detail={`${String(e.route ?? "unknown route")}${e.route_type ? ` · ${String(e.route_type)}` : ""} · first ${when(e.first_seen_at as string | null)}`}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          label="money out"
          title="Withdrawals"
          aside={
            <Pill tone={stuckWithdrawals.length ? "negative" : openWithdrawals.length ? "accent" : "positive"}>
              {stuckWithdrawals.length ? `${stuckWithdrawals.length} stuck` : `${openWithdrawals.length} open`}
            </Pill>
          }
        >
          {withdrawals.length === 0 ? (
            <Empty>Nobody has asked for money back.</Empty>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {withdrawals.map((w) => {
                const open = String(w.status) === "requested";
                const stale = isStuck(String(w.status), w.requested_at as string);
                return (
                  <Event
                    key={w.id as string}
                    tone={stale ? "negative" : open ? "accent" : "positive"}
                    who={`${nameOf.get(w.business_id as string) ?? "—"} · ${usd(Number(w.amount_usd_minor ?? 0))}`}
                    what={`${String(w.status)}${stale ? ` — stuck over ${STUCK_AFTER_DAYS} days` : ""}`}
                    when={when(w.requested_at as string)}
                    detail={w.note ? String(w.note) : undefined}
                  />
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          label="journal"
          title="Recent trouble"
          aside={<Pill tone={problems.length ? "accent" : "positive"}>{problems.length || "clear"}</Pill>}
        >
          {problems.length === 0 ? (
            <Empty>Nothing has gone wrong recently.</Empty>
          ) : (
            <ul className="flex max-h-[28rem] flex-col gap-3.5 overflow-y-auto pr-1">
              {problems.map((p, i) => (
                <Event
                  key={i}
                  tone="accent"
                  who={nameOf.get(p.business_id as string) ?? "—"}
                  what={String(p.entry_type)}
                  when={when(p.created_at as string)}
                  detail={JSON.stringify(p.content).slice(0, 180)}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="mt-8 pb-4 text-center font-mono text-[11px] tracking-[0.04em] text-ink-faint">
        Reads across every customer · visible only to the addresses in FOUNDER_EMAILS, behind a second factor
      </p>
    </div>
  );
}
