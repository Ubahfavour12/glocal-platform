import { AddFundsButton } from "@/components/wallet/AddFundsButton";
import { MetricChip } from "@/components/ui/MetricChip";
import { PageHeader } from "@/components/ui/PageHeader";
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

async function liveRateChip() {
  try {
    const snapshot = await fetchUsdRate("NGN");
    return {
      value: `₦${Math.round(effectiveRate(snapshot)).toLocaleString()}/$`,
      hint: "Refreshed hourly · final price you pay",
    };
  } catch {
    return { value: "—", hint: "Rate temporarily unavailable" };
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

export default async function WalletPage() {
  const [fx, wallet] = await Promise.all([liveRateChip(), walletData()]);

  const balanceMinor = wallet?.balanceMinor ?? 0;
  const dailyMinor = wallet?.business.daily_budget_usd_minor ?? 1000;
  const runway = dailyMinor > 0 ? Math.floor(Math.max(0, balanceMinor) / dailyMinor) : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label={`wallet${wallet ? ` · ${wallet.business.name}` : ""}`}
        title="Balance & runway"
        subtitle="USD is the anchor for every number. Top up any time; unspent balance is always refundable."
        stat={{ value: `$${(balanceMinor / 100).toFixed(2)}`, caption: `${runway} days of runway` }}
      />

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricChip label="balance" value={`$${(balanceMinor / 100).toFixed(2)}`} />
        <MetricChip
          label="runway"
          value={`${runway} days`}
          hint={`At $${(dailyMinor / 100).toFixed(0)}/day`}
        />
        <MetricChip label="fx rate" value={fx.value} hint={fx.hint} />
      </section>

      {wallet ? (
        <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">add funds</div>
          <div className="mt-3">
            <AddFundsButton businessId={wallet.business.id} />
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">preview mode</div>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in and finish onboarding to activate your wallet.
          </p>
        </section>
      )}

      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">ledger</div>
        {wallet && wallet.ledger.length > 0 ? (
          <ul className="mt-3 divide-y divide-line-soft">
            {wallet.ledger.map((e, i) => (
              <li key={i} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-sm">{KIND_LABELS[e.kind] ?? e.kind}</span>
                  <span className="datalabel ml-3">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                <span
                  className={`font-mono text-sm ${
                    e.amount_usd_minor > 0 ? "text-positive" : "text-ink"
                  }`}
                >
                  {e.amount_usd_minor > 0 ? "+" : ""}
                  {(e.amount_usd_minor / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            Every top-up, ad spend, fee, and refund appears here, append-only,
            reconciled daily to the cent. Unspent balance is refundable anytime;
            money delivered to ad networks is not.
          </p>
        )}
      </section>
    </div>
  );
}
