import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic"; // statement must always be current
export const metadata = { title: "Statement" };

interface LedgerRow {
  kind: string;
  amount_usd_minor: number;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  topup: "Top-up",
  ad_spend: "Ad spend",
  markup_fee: "Service fee",
  subscription: "Subscription",
  refund: "Refund",
  adjustment: "Adjustment",
};

const usd = (m: number) => `$${(m / 100).toFixed(2)}`;

async function statementData() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return null;

  const { data: balanceRow } = await supabase
    .from("wallet_balances")
    .select("wallet_id, balance_usd_minor")
    .eq("business_id", business.id)
    .maybeSingle();

  let entries: LedgerRow[] = [];
  if (balanceRow?.wallet_id) {
    // Oldest-first so we can accumulate a running balance, then reverse for display.
    const { data } = await supabase
      .from("ledger_entries")
      .select("kind, amount_usd_minor, created_at")
      .eq("wallet_id", balanceRow.wallet_id)
      .order("created_at", { ascending: true });
    entries = (data as LedgerRow[]) ?? [];
  }

  let running = 0;
  const rows = entries.map((e) => {
    running += e.amount_usd_minor;
    return { ...e, balanceAfter: running };
  });
  rows.reverse(); // newest first for display

  return {
    business,
    balanceMinor: Number(balanceRow?.balance_usd_minor ?? 0),
    rows,
  };
}

export default async function StatementPage() {
  const data = await statementData();
  const balanceMinor = data?.balanceMinor ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label={`statement${data ? ` · ${data.business.name}` : ""}`}
        title="Billing statement"
        subtitle="Every top-up, ad spend, service fee, subscription, and refund — append-only and reconciled daily to the cent."
        stat={{ value: usd(balanceMinor), caption: "current balance" }}
      />

      <div className="mt-6 flex items-center justify-between">
        <div className="datalabel">full history</div>
        <Link href="/wallet" className="text-xs text-accent hover:text-accent-bright">
          ← Back to wallet
        </Link>
      </div>

      <section className="mt-3 overflow-x-auto rounded-card border border-line bg-surface-raised">
        {data && data.rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="datalabel px-5 py-3 font-normal">Date</th>
                <th className="datalabel px-5 py-3 font-normal">Type</th>
                <th className="datalabel px-5 py-3 text-right font-normal">Amount</th>
                <th className="datalabel px-5 py-3 text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((e, i) => (
                <tr key={i} className="border-b border-line-soft last:border-0">
                  <td className="px-5 py-3 text-ink-muted">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">{KIND_LABELS[e.kind] ?? e.kind}</td>
                  <td
                    className={`px-5 py-3 text-right font-mono ${
                      e.amount_usd_minor > 0 ? "text-positive" : "text-ink"
                    }`}
                  >
                    {e.amount_usd_minor > 0 ? "+" : ""}
                    {(e.amount_usd_minor / 100).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-ink-muted">
                    {(e.balanceAfter / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-muted">
            No entries yet. Top-ups, ad spend, fees, subscriptions, and refunds will appear here as
            they happen.
          </p>
        )}
      </section>
    </div>
  );
}
