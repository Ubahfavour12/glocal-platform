import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import { economicsTotals, rankByMargin, type CustomerCosts } from "@/lib/admin/economics";
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
  `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
function isStuck(status: string, requestedAt: string): boolean {
  if (status !== "requested") return false;
  return Date.now() - new Date(requestedAt).getTime() > STUCK_AFTER_DAYS * 86_400_000;
}

const TONE: Record<string, string> = {
  spending: "text-positive",
  ready: "text-accent-bright",
  empty_wallet: "text-negative",
  free: "text-ink-faint",
  onboarding: "text-ink-faint",
};

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
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isFounder(user?.email, configuredFounders())) notFound();

  const svc = createServiceClient();

  const [bizRes, walletRes, adsRes, journalRes, wdRes, creativeRes, subRes, markupRes, walletIdRes] =
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

  const costRows: CustomerCosts[] = rows.map((r) => ({
    businessId: r.businessId,
    name: r.name,
    tier: r.plan,
    renderCostUsdMinor: renderCost.get(r.businessId)?.usdMinor ?? 0,
    renderCount: renderCost.get(r.businessId)?.count ?? 0,
    markupRevenueUsdMinor: markup.get(r.businessId) ?? 0,
    subscribed: subs.get(r.businessId)?.active ?? false,
  }));
  const margins = rankByMargin(costRows).filter((m) => m.costUsdMinor > 0 || m.revenueUsdMinor > 0);
  const econ = economicsTotals(costRows);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        label="founder console"
        title="Everyone, everything"
        subtitle="Every customer, wallet and error in one view. Ordered by who needs attention."
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: "Customers", v: String(t.customers) },
          { k: "Paying", v: String(t.paying) },
          { k: "Running ads", v: String(t.running) },
          { k: "Customer money held", v: usd(t.walletUsdMinor) },
        ].map((s) => (
          <div key={s.k} className="rounded-card border border-line bg-surface-raised p-4">
            <div className="datalabel">{s.k}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{s.v}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        &ldquo;Customer money held&rdquo; is unspent wallet balance — money owed back, not revenue.
      </p>

      <div className="mt-6 overflow-x-auto rounded-card border border-line bg-surface-raised">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-line text-ink-faint">
            <tr>
              {["Business", "State", "Plan", "Wallet", "Budget/day", "Live ads", "Last active"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 text-xs font-medium uppercase tracking-wide">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => {
              const h = health(r);
              return (
                <tr key={r.businessId} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="text-xs text-ink-faint">{r.ownerEmail ?? "unknown email"}</div>
                  </td>
                  <td className={`px-4 py-3 text-xs font-medium ${TONE[h]}`}>{HEALTH_LABEL[h]}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.plan}</td>
                  <td className="px-4 py-3 text-ink-muted">{usd(r.balanceUsdMinor)}</td>
                  <td className="px-4 py-3 text-ink-muted">{usd(r.dailyBudgetUsdMinor)}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.liveAds}</td>
                  <td className="px-4 py-3 text-ink-faint">{when(r.lastActivityAt)}</td>
                </tr>
              );
            })}
            {ranked.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  No businesses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">what each customer costs to serve</div>
        <p className="mt-2 text-sm text-ink-muted">
          Renders bill per generation and the subscription is fixed, so a heavy
          renderer can cost more than they pay. Worst margin first.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { k: "Revenue", v: usd(econ.revenueUsdMinor) },
            { k: "Render cost", v: usd(econ.costUsdMinor) },
            { k: "Margin", v: usd(econ.marginUsdMinor) },
            { k: "Underwater", v: String(econ.underwaterCount) },
          ].map((s2) => (
            <div key={s2.k}>
              <div className="datalabel">{s2.k}</div>
              <div className="mt-0.5 text-lg font-semibold text-ink">{s2.v}</div>
            </div>
          ))}
        </div>
        {margins.length === 0 ? (
          <p className="mt-4 text-sm text-ink-faint">
            Nothing rendered and nothing charged yet.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {margins.map((m) => (
              <li key={m.businessId} className="text-sm">
                <span className="text-ink">{m.name}</span>
                <span className="mx-2 text-ink-faint">·</span>
                <span className={m.underwater ? "text-negative" : "text-positive"}>
                  {m.underwater ? "costs more than they pay" : usd(m.marginUsdMinor)}
                </span>
                <span className="mx-2 text-ink-faint">·</span>
                <span className="text-ink-faint">
                  {m.renderCount} render{m.renderCount === 1 ? "" : "s"} ={" "}
                  {usd(m.costUsdMinor)} · pays {usd(m.revenueUsdMinor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">withdrawals</div>
        <p className="mt-2 text-sm text-ink-muted">
          Money going back to customers. Refunds return to the card that paid in, sent by
          the daily job; a request closes itself once none are still in flight.
        </p>
        {withdrawals.length === 0 ? (
          <p className="mt-4 text-sm text-ink-faint">Nobody has asked for money back.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {withdrawals.map((w) => {
              const open = String(w.status) === "requested";
              const stale = isStuck(String(w.status), w.requested_at as string);
              return (
                <li key={w.id as string} className="text-sm leading-relaxed">
                  <span className="text-ink">{nameOf.get(w.business_id as string) ?? "—"}</span>
                  <span className="mx-2 text-ink-faint">·</span>
                  <span className="text-ink-muted">{usd(Number(w.amount_usd_minor ?? 0))}</span>
                  <span className="mx-2 text-ink-faint">·</span>
                  <span className={stale ? "text-negative" : open ? "text-accent-bright" : "text-positive"}>
                    {String(w.status)}
                    {stale ? ` — stuck, older than ${STUCK_AFTER_DAYS} days` : ""}
                  </span>
                  <span className="mx-2 text-ink-faint">·</span>
                  <span className="text-ink-faint">
                    asked {when(w.requested_at as string)}
                  </span>
                  {w.note ? (
                    <div className="mt-0.5 text-xs text-ink-muted">{String(w.note)}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">recent trouble</div>
        <p className="mt-2 text-sm text-ink-muted">
          Journal entries that reported a failure, a skip or a wait. Newest first.
        </p>
        {problems.length === 0 ? (
          <p className="mt-4 text-sm text-ink-faint">Nothing has gone wrong recently.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {problems.map((p, i) => (
              <li key={i} className="text-sm leading-relaxed">
                <span className="text-ink">{nameOf.get(p.business_id as string) ?? "—"}</span>
                <span className="mx-2 text-ink-faint">·</span>
                <span className="text-negative">{String(p.entry_type)}</span>
                <span className="mx-2 text-ink-faint">·</span>
                <span className="text-ink-faint">{when(p.created_at as string)}</span>
                <div className="mt-0.5 break-words text-xs text-ink-muted">
                  {JSON.stringify(p.content).slice(0, 220)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-ink-faint">
        This page reads across every customer. It is visible only to the addresses in
        <code className="mx-1 text-ink-muted">FOUNDER_EMAILS</code>.
      </p>
    </div>
  );
}
