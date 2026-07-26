import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/dashboard/activity";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organic" };

interface OrganicContent {
  action?: string;
  networks?: string[];
  postId?: string;
  publishAt?: string;
}

export default async function OrganicPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const bizId = business?.id as string | undefined;

  const [connRes, postsRes] = bizId
    ? await Promise.all([
        supabase.from("social_connections").select("network, display_name, status").eq("business_id", bizId).eq("status", "active"),
        supabase
          .from("journal_entries")
          .select("content, created_at")
          .eq("business_id", bizId)
          .eq("entry_type", "note")
          .contains("content", { action: "organic_post" })
          .order("created_at", { ascending: false })
          .limit(20),
      ])
    : [{ data: [] }, { data: [] }];

  const connections = (connRes.data ?? []) as { network: string; display_name: string | null }[];
  const posts = (postsRes.data ?? []) as { content: OrganicContent; created_at: string }[];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label="organic"
        title="Posting calendar"
        subtitle="The agent posts organically alongside your paid ads, once a day, on the accounts you connect."
        stat={{ value: String(posts.length), caption: "posts logged" }}
      />

      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">connected accounts</div>
        {connections.length === 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-muted">
              No accounts connected yet. Connect Facebook or Instagram and the agent posts organically
              alongside your ads.
            </p>
            <Link href="/settings" className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright">
              Connect socials
            </Link>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {connections.map((c, i) => (
              <span key={i} className="rounded-full bg-surface-overlay px-3 py-1 text-xs text-ink">
                {c.network} · {c.display_name ?? "connected"}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="datalabel">scheduled &amp; posted</div>
        {posts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">
            Nothing scheduled yet, the agent posts once a day once you&apos;re connected and live.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {posts.map((p, i) => (
              <li key={i} className="flex items-center justify-between rounded-card border border-line bg-surface-raised p-3">
                <div className="flex items-center gap-2">
                  {(p.content.networks ?? []).map((n) => (
                    <span key={n} className="rounded bg-surface-overlay px-2 py-0.5 text-[11px] text-ink-muted">
                      {n}
                    </span>
                  ))}
                  <span className="text-sm text-ink-muted">Organic post</span>
                </div>
                <span className="font-mono text-xs text-ink-faint">{relativeTime(p.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
