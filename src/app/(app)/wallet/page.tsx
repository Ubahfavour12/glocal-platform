import { MetricChip } from "@/components/ui/MetricChip";

export default function WalletPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="datalabel">wallet</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Balance &amp; runway</h1>

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricChip label="balance" value="$0.00" />
        <MetricChip label="runway" value="0 days" hint="At your daily budget" />
        <MetricChip label="fx rate" value="—" hint="Refreshed hourly, final price shown" />
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
