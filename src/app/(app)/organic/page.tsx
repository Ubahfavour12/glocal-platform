import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/dashboard/activity";
import { PageHeader } from "@/components/ui/PageHeader";
import { CalendarIcon, FacebookIcon, InstagramIcon, TikTokIcon } from "@/components/ui/icons";
import { currentBusiness } from "@/lib/business/current";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organic" };

interface OrganicContent {
  action?: string;
  networks?: string[];
  postId?: string;
  publishAt?: string;
}

function networkIcon(name: string, cls = "h-4 w-4"): ReactNode {
  const n = name.toLowerCase();
  if (n.includes("insta")) return <InstagramIcon className={cls} />;
  if (n.includes("tiktok") || n.includes("tik")) return <TikTokIcon className={cls} />;
  if (n.includes("face") || n === "fb") return <FacebookIcon className={cls} />;
  return <CalendarIcon className={cls} />;
}

export default async function OrganicPage() {
  const supabase = await createClient();
  const business = await currentBusiness<{ id: string } & Record<string, unknown>>(
    supabase,
    "id",
  );
  const bizId = business?.id as string | undefined;

  const [connRes, postsRes] = bizId
    ? await Promise.all([
        supabase
          .from("social_connections")
          .select("network, display_name, status")
          .eq("business_id", bizId)
          .eq("status", "active"),
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
    <div className="mx-auto max-w-5xl 2xl:max-w-6xl">
      <PageHeader
        label="organic"
        title="Posting calendar"
        subtitle="The agent posts organically alongside your paid ads, once a day, on the accounts you connect."
        stat={{ value: String(posts.length), caption: "posts logged" }}
      />

      <section className="mt-8">
        <div className="datalabel">connected accounts</div>
        {connections.length === 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface-raised p-5">
            <p className="max-w-md text-sm text-ink-muted">
              No accounts connected yet. Connect Facebook or Instagram and the agent posts
              organically alongside your ads.
            </p>
            <Link
              href="/settings"
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Connect socials
            </Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connections.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-ink">
                  {networkIcon(c.network)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{c.display_name ?? "Connected"}</div>
                  <div className="datalabel">{c.network}</div>
                </div>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" title="active" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="datalabel">scheduled &amp; posted</div>
        {posts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">
            Nothing scheduled yet. The agent posts once a day once you&apos;re connected and live.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {posts.map((p, i) => {
              const networks = p.content.networks ?? [];
              return (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-card border border-line bg-surface-raised p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-1.5">
                      {networks.length > 0 ? (
                        networks.map((n) => (
                          <span
                            key={n}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-overlay text-ink-muted"
                          >
                            {networkIcon(n, "h-3.5 w-3.5")}
                          </span>
                        ))
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-overlay text-ink-muted">
                          <CalendarIcon className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-ink">Organic post</span>
                  </div>
                  <span className="font-mono text-xs text-ink-faint">{relativeTime(p.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
