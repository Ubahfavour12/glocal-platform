import { createClient } from "@/lib/supabase/server";
import { describeActivity, relativeTime, type RawEntry } from "@/lib/dashboard/activity";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        label="activity"
        title="Everything the agent did"
        subtitle="Every launch, pause, budget move, compliance scan, and verdict, in plain language."
      />

      {entries.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="text-sm text-ink-muted">
            The full audit trail lands here, every launch, pause, budget move, compliance scan, and
            verdict, in plain language, within a minute of it happening. Nothing yet; finish
            onboarding and the agent starts working tonight.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col">
          {entries.map((e, i) => (
            <li key={i} className="flex items-start gap-3 border-b border-line py-3 last:border-0">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <div className="flex-1">
                <p className="text-sm text-ink">{describeActivity(e)}</p>
              </div>
              <span className="shrink-0 font-mono text-xs text-ink-faint">
                {e.created_at ? relativeTime(e.created_at) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
