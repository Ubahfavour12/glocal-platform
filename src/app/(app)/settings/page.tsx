import { headers } from "next/headers";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { PixelCard } from "@/components/settings/PixelCard";
import { MediaUpload } from "@/components/settings/MediaUpload";
import { ConnectShopify } from "@/components/settings/ConnectShopify";

export const dynamic = "force-dynamic";

type Goal = "sales" | "leads" | "whatsapp" | "visits";
type Persona = "conservative" | "smart" | "aggressive";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, daily_budget_usd_minor, goal, persona, full_auto")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="datalabel">settings</div>
        <p className="mt-4 text-sm text-ink-muted">Finish onboarding to manage your settings.</p>
      </div>
    );
  }

  const bizId = business.id as string;
  const h = await headers();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    `https://${h.get("host") ?? "gg-platform-dun.vercel.app"}`;

  const [walletRes, socialRes, storeRes, mediaRes] = await Promise.all([
    supabase.from("wallet_balances").select("balance_usd_minor").eq("business_id", bizId).maybeSingle(),
    supabase.from("social_connections").select("network, display_name").eq("business_id", bizId).eq("status", "active"),
    supabase.from("store_connections").select("id, provider, status").eq("business_id", bizId).eq("status", "active").maybeSingle(),
    supabase.from("media_assets").select("public_url, kind").eq("business_id", bizId).order("created_at", { ascending: false }).limit(12),
  ]);

  const balanceUsdMinor = Number(walletRes.data?.balance_usd_minor ?? 0);
  const socials = (socialRes.data ?? []) as { network: string; display_name: string | null }[];
  const store = storeRes.data as { provider: string } | null;
  const media = ((mediaRes.data ?? []) as { public_url: string; kind: string }[]).map((m) => ({
    publicUrl: m.public_url,
    kind: m.kind,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="datalabel">settings</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your account</h1>

      <div className="mt-6 flex flex-col gap-4">
        <SettingsForm
          initial={{
            dailyBudgetUsdMinor: business.daily_budget_usd_minor as number,
            goal: business.goal as Goal,
            persona: (business.persona as Persona) ?? "smart",
            fullAuto: Boolean(business.full_auto),
          }}
          balanceUsdMinor={balanceUsdMinor}
        />

        {/* Connect socials */}
        <div className="rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">social accounts</div>
          {socials.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              Connect Facebook or Instagram once and the agent posts organically alongside your ads —
              no dashboards, no you-in-the-middle.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {socials.map((s, i) => (
                <span key={i} className="rounded-full bg-surface-overlay px-3 py-1 text-xs text-ink">
                  {s.network} · {s.display_name ?? "connected"}
                </span>
              ))}
            </div>
          )}
          <a
            href="/api/oauth/meta/start"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            {socials.length === 0 ? "Connect Facebook / Instagram" : "Connect another account"}
          </a>
        </div>

        {/* Store connection */}
        <ConnectShopify connected={store ? store.provider : null} />

        <MediaUpload businessId={bizId} existing={media} />
        <PixelCard businessId={bizId} origin={origin} />
      </div>

      <p className="mt-6 text-center text-xs text-ink-faint">
        Your data runs your ads and nothing else.{" "}
        <Link href="/privacy" className="underline hover:text-ink-muted">
          How we use it
        </Link>
      </p>
    </div>
  );
}
