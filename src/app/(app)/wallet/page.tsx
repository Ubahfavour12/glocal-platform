import type { ReactNode } from "react";
import { AddFundsButton } from "@/components/wallet/AddFundsButton";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  ArrowInIcon,
  ArrowOutIcon,
  BoltIcon,
  CoinsIcon,
  ReceiptIcon,
  RefreshIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { effectiveRate } from "@/lib/money/fx";
import { fetchUsdRate } from "@/lib/money/rates";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic"; // balance must always be current
export const metadata = { title: "Wallet" };

interface LedgerRow {
  kind: string;
  amount_usd_minor: number;
  created_at: string;
}

async function liveRate() {
  try {
    const snapshot = await fetchUsdRate("NGN");
    return { value: `₦${Math.round(effectiveRate(snapshot)).toLocaleString()}/$`, ok: true };
  } catch {
    return { value: "—", ok: false };
  }
}

async function walletData() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, daily_budget_usd_minor")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return null;

  const { data: balanceRow } = await supabase
    .from("wallet_balances")
    .select("wallet_id, balance_usd_minor")
    .eq("business_id", business.id)
    .maybeSingle();

  let ledger: LedgerRow[] = [];
  if (balanceRow?.wallet_id) {
    const { data } = await supabase
      .from("ledger_entries")
      .select("kind, amount_usd_minor, created_at")
      .eq("wallet_id", balanceRow.wallet_id)
      .order("created_at", { ascending: false })
      .limit(10);
    ledger = (data as LedgerRow[]) ?? [];
  }

  return {
    business,
    balanceMinor: Number(balanceRow?.balance_usd_minor ?? 0),
    ledger,
  };
}

const KIND_LABELS: Record<string, string> = {
  topup: "Top-up",
  ad_spend: "Ad spend",
  markup_fee: "Service fee",
  subscription: "Subscription",
  refund: "Refund",
  adjustment: "Adjustment",
};

function kindIcon(kind: string): ReactNode {
  const cls = "h-4 w-4";
  switch (kind) {
    case "topup":
    case "refund":
      return <ArrowInIcon className={cls} />;
    case "ad_spend":
      return <BoltIcon className={cls} />;
    case "markup_fee":
      return <ReceiptIcon className={cls} />;
    case "subscription":
      return <WalletIcon className={cls} />;
    default:
      return <CoinsIcon className={cls} />;
  }
}

export default async function WalletPage() {
  const [fx, wallet] = await Promise.all([liveRate(), walletData()]);

  const balanceMinor = wallet?.balanceMinor ?? 0;
  const dailyMinor = wallet?.business.daily_budget_usd_minor ?? 1000;
  const runway = dailyMinor > 0 ? Math.floor(Math.max(0, balanceMinor) / dailyMinor) : 0;
  const runwayPct = Math.min(100, (runway / 30) * 100); // visual scale to a 30-day horizon

  /**
   * The wallet emptying is the one moment the product silently stops working:
   * ads pause, the duel cannot resolve, and nothing else on screen says so. It
   * deserves a real state rather than a $0.00 that looks like any other number.
   */
  const health =
    wallet === null ? "preview" : balanceMinor <= 0 ? "empty" : runway <= 3 ? "critical" : "ok";

  return (
    <div className="mx-auto max-w-5xl 2xl:max-w-6xl">
      <PageHeader
        label={`wallet${wallet ? ` · ${wallet.business.name}` : ""}`}
        title="Balance & runway"
        subtitle="USD is the anchor for every number. Top up any time; unspent balance is always refundable."
      />

      {health === "empty" && (
        <section className="mt-8 rounded-card border border-negative/50 bg-negative/10 p-5">
          <div className="datalabel text-negative">spending has stopped</div>
          <p className="mt-2 text-sm text-ink">
            Your balance is empty, so your ads are paused. Nothing is being spent, and nothing is
            being lost, but no one is seeing them either.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Top up and I pick straight back up where I left off. Your champion, your test history and
            everything I have learned are all still here.
          </p>
        </section>
      )}

      {health === "critical" && (
        <section className="mt-8 rounded-card border border-accent/50 bg-accent-soft p-5">
          <div className="datalabel text-accent-bright">running low</div>
          <p className="mt-2 text-sm text-ink">
            About {runway} {runway === 1 ? "day" : "days"} left at your current budget. When it hits
            zero your ads pause, and a test that stops halfway tells you nothing.
          </p>
        </section>
      )}

      {/* Balance + runway hero */}
      <section className="mt-8 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-card border border-line bg-surface-raised p-6">
          <div className="flex items-center gap-2 text-ink-muted">
            <WalletIcon className="h-4 w-4" />
            <span className="datalabel">available balance</span>
          </div>
          <div
            className={`mt-3 font-mono text-4xl font-semibold tracking-tight ${
              health === "empty" ? "text-negative" : "text-ink"
            }`}
          >
            ${(balanceMinor / 100).toFixed(2)}
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">Runway</span>
              <span className="font-mono text-ink-muted">
                {runway} {runway === 1 ? "day" : "days"} at ${(dailyMinor / 100).toFixed(0)}/day
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-overlay">
              <div
                className={`h-full rounded-full transition-all ${
                  health === "empty" || health === "critical" ? "bg-negative" : "bg-accent"
                }`}
                style={{ width: `${Math.max(runwayPct, balanceMinor > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-card border border-line bg-surface-raised p-6">
          <div>
            <div className="flex items-center gap-2 text-ink-muted">
              <RefreshIcon className="h-4 w-4" />
              <span className="datalabel">live fx rate</span>
            </div>
            <div className="mt-3 font-mono text-2xl font-semibold text-ink">{fx.value}</div>
            <p className="mt-1 text-xs text-ink-faint">
              {fx.ok ? "Refreshed hourly. This is the final price you pay." : "Rate temporarily unavailable."}
            </p>
          </div>
        </div>
      </section>

      {wallet ? (
        <section className="mt-4 rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">add funds</div>
          <div className="mt-3">
            <AddFundsButton businessId={wallet.business.id} />
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">preview mode</div>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in and finish onboarding to activate your wallet.
          </p>
        </section>
      )}

      <section className="mt-4 rounded-card border border-line bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <div className="datalabel">ledger · last 10</div>
          <a href="/statement" className="text-xs text-accent hover:text-accent-bright">
            Full statement →
          </a>
        </div>
        {wallet && wallet.ledger.length > 0 ? (
          <ul className="mt-3 divide-y divide-line-soft">
            {wallet.ledger.map((e, i) => {
              const credit = e.amount_usd_minor > 0;
              return (
                <li key={i} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        credit ? "bg-accent-soft text-positive" : "bg-surface-overlay text-ink-muted"
                      }`}
                    >
                      {credit ? <ArrowInIcon className="h-4 w-4" /> : kindIcon(e.kind)}
                    </span>
                    <div>
                      <div className="text-sm text-ink">{KIND_LABELS[e.kind] ?? e.kind}</div>
                      <div className="datalabel">{new Date(e.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                  <span className={`font-mono text-sm ${credit ? "text-positive" : "text-ink"}`}>
                    {credit ? "+" : ""}
                    {(e.amount_usd_minor / 100).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            Every top-up, ad spend, fee, and refund appears here, append-only, reconciled daily to
            the cent. Unspent balance is refundable anytime; money delivered to ad networks is not.
          </p>
        )}
      </section>
    </div>
  );
}
