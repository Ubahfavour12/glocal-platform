import { MetricChip } from "@/components/ui/MetricChip";
import { effectiveRate } from "@/lib/money/fx";
import { fetchUsdRate } from "@/lib/money/rates";

export const revalidate = 3600; // hourly, matching the FX refresh cycle

async function liveRateChip() {
  try {
    const snapshot = await fetchUsdRate("NGN");
    return {
      value: `₦${Math.round(effectiveRate(snapshot)).toLocaleString()}/$`,
      hint: `Refreshed hourly · final price you pay`,
    };
  } catch {
    return { value: "—", hint: "Rate temporarily unavailable" };
  }
}

export default async function WalletPage() {
  const fx = await liveRateChip();
  return (
    <div className="mx-auto max-w-5xl">
      <div className="datalabel">wallet</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Balance &amp; runway</h1>

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricChip label="balance" value="$0.00" />
        <MetricChip label="runway" value="0 days" hint="At your daily budget" />
        <MetricChip label="fx rate" value={fx.value} hint={fx.hint} />
      </section>

      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">ledger</div>
        <p className="mt-3 text-sm text-ink-muted">
          Every top-up, ad spend, fee, and refund appears here — append-only,
          reconciled daily to the cent. Unspent balance is refundable anytime;
          money delivered to ad networks is not.
        </p>
      </section>
    </div>
  );
}
