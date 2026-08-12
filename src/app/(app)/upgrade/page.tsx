import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { SubscribeCta } from "@/components/billing/SubscribeCta";
import { TIERS, EXTRA_RENDER_NOTE } from "@/lib/billing/tiers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans" };

export default async function UpgradePage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, plan")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const businessId = (business?.id as string) ?? undefined;
  const currentPlan = (business?.plan as string) ?? "free";
  const isFree = currentPlan === "free";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label="plans"
        title="Choose your plan"
        subtitle="The subscription runs your agent; a small markup on ad spend is how we keep the lights on. Start free, upgrade when it's earning."
      />

      {/* Free / trial context */}
      <div
        className={`mt-6 rounded-card border p-5 ${
          isFree ? "border-accent/40 bg-accent-soft" : "border-line bg-surface-raised"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="datalabel">free trial</div>
          {isFree && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-white">you&apos;re here</span>}
        </div>
        <p className="mt-2 text-sm text-ink">
          Onboard, get your ranked ad concepts, and see <strong>one</strong> render from your product
          photo — free. To launch real ads and render at volume, pick a plan below.
        </p>
      </div>

      {/* Paid tiers */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const current = currentPlan === tier.id;
          return (
            <div
              key={tier.id}
              className={`flex flex-col rounded-card border p-5 ${
                tier.recommended ? "border-accent bg-surface-raised" : "border-line bg-surface-raised"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">{tier.name}</div>
                {tier.recommended && (
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] text-accent-bright">
                    most popular
                  </span>
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-mono text-3xl font-semibold text-ink">${tier.priceUsdMonthly}</span>
                <span className="text-sm text-ink-faint">/mo</span>
              </div>
              <div className="datalabel mt-1">{tier.markupLabel} · {tier.platforms}</div>

              <p className="mt-3 text-sm text-ink-muted">{tier.tagline}</p>

              <ul className="mt-4 flex flex-1 flex-col gap-2">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-ink-muted">
                    <span className="mt-0.5 text-accent-bright">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <SubscribeCta
                tierId={tier.id}
                tierName={tier.name}
                businessId={businessId}
                current={current}
                recommended={tier.recommended}
              />
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-ink-faint">
        {EXTRA_RENDER_NOTE} · Prices in USD. A 3% currency buffer applies on conversion. Cancel any time.
      </p>
    </div>
  );
}
