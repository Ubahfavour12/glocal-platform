import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { describeActivity, relativeTime, type RawEntry } from "@/lib/dashboard/activity";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  BoltIcon,
  CalendarIcon,
  CrownIcon,
  PauseIcon,
  RefreshIcon,
  ShieldIcon,
  TrendIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

function nodeIcon(action: string): ReactNode | null {
  const cls = "h-3.5 w-3.5";
  switch (action) {
    case "verdict":
      return <CrownIcon className={cls} />;
    case "fatigue":
      return <RefreshIcon className={cls} />;
    case "gateway_scan":
    case "rejection":
      return <ShieldIcon className={cls} />;
    case "plan_created":
    case "organic_post":
    case "organic_scheduled":
      return <CalendarIcon className={cls} />;
    case "plan_launched":
      return <BoltIcon className={cls} />;
    case "launch_skipped":
      return <PauseIcon className={cls} />;
    case "pipeline_batch":
    case "render_batch":
      return <TrendIcon className={cls} />;
    default:
      return null;
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export default async function ActivityPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const entries: RawEntry[] = business
    ? ((
        await supabase
          .from("journal_entries")
          .select("entry_type, content, created_at")
          .eq("business_id", business.id)
          .order("created_at", { ascending: false })
          .limit(60)
      ).data ?? [])
    : [];

  // Group in order into day buckets (entries already newest-first).
  const groups: { label: string; items: RawEntry[] }[] = [];
  for (const e of entries) {
    const label = e.created_at ? dayLabel(e.created_at) : "Earlier";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        label="activity"
        title="Everything the agent did"
        subtitle="Every launch, pause, budget move, compliance scan, and verdict, in plain language."
      />

      {entries.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-10 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-muted">
            The full audit trail lands here within a minute of anything happening: every launch,
            pause, budget move, compliance scan, and verdict, in plain language. Nothing yet. Finish
            onboarding and the agent starts working tonight.
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          {groups.map((group, gi) => (
            <div key={gi}>
              <div className="datalabel mb-3">{group.label}</div>
              <ol className="relative ml-3 border-l border-line-soft">
                {group.items.map((e, i) => {
                  const icon = e.content?.action ? nodeIcon(e.content.action) : null;
                  return (
                    <li key={i} className="relative pb-5 pl-6 last:pb-0">
                      <span className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-overlay text-ink-muted">
                        {icon ?? <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      </span>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm leading-snug text-ink">{describeActivity(e)}</p>
                        <span className="shrink-0 font-mono text-xs text-ink-faint">
                          {e.created_at ? relativeTime(e.created_at) : ""}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
