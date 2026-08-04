import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/dashboard/activity";
import { PageHeader } from "@/components/ui/PageHeader";
import { CrownIcon, FlagIcon, TrophyIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Duel" };

export default async function DuelPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const bizId = business?.id as string | undefined;

  const [testRes, verdictsRes] = bizId
    ? await Promise.all([
        supabase
          .from("ab_tests")
          .select("id, test_date, status, champion_ad_id, challenger_ad_ids")
          .eq("business_id", bizId)
          .order("test_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("verdicts")
          .select("metric_used, decided_at, ab_tests!inner(business_id)")
          .eq("ab_tests.business_id", bizId)
          .order("decided_at", { ascending: false })
          .limit(10),
      ])
    : [{ data: null }, { data: [] }];

  const test = testRes.data as
    | { status: string; test_date: string; champion_ad_id: string | null; challenger_ad_ids: string[] }
    | null;
  const verdicts = (verdictsRes.data ?? []) as { metric_used: string; decided_at: string }[];
  const challengerCount = test?.challenger_ad_ids?.length ?? 0;
  const ringSize = 1 + Math.max(2, challengerCount);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label="the duel"
        title="Champion vs challengers"
        subtitle="Two fresh challengers take on your champion every day. A winner is declared only after 24 hours and 5,000 impressions."
        stat={test ? { value: String(ringSize), caption: "ads in the ring" } : undefined}
      />

      {!test ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-10 text-center">
          <TrophyIcon className="mx-auto h-8 w-8 text-ink-faint" />
          <p className="mx-auto mt-4 max-w-md text-sm text-ink-muted">
            No test running yet. The daily duel appears here once your first campaign is live:
            threshold progress, the rolling 3-day window, and the agent&apos;s verdict history.
          </p>
        </div>
      ) : (
        <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
          <div className="flex items-center justify-between">
            <span className="datalabel">today&apos;s duel · {test.test_date}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                test.status === "decided"
                  ? "bg-accent-soft text-accent-bright"
                  : "bg-surface-overlay text-ink-muted"
              }`}
            >
              {test.status === "decided" ? "verdict in" : "running"}
            </span>
          </div>

          {/* The ring: champion on one side, challengers on the other, a vs in between */}
          <div className="mt-5 flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
            <div className="flex-1 rounded-lg border border-accent bg-accent-soft p-5">
              <div className="flex items-center gap-2">
                <CrownIcon className="h-4 w-4 text-accent-bright" />
                <span className="datalabel text-accent-bright">champion</span>
              </div>
              <div className="mt-3 text-base font-semibold text-ink">
                {test.champion_ad_id ? "Defending the crown" : "First run, no champion yet"}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Holds the crown until a challenger beats it over the window.
              </p>
            </div>

            <div className="flex shrink-0 items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface font-mono text-xs text-ink-muted">
                vs
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-3">
              {Array.from({ length: Math.max(2, challengerCount) }).map((_, i) => {
                const live = i < challengerCount;
                return (
                  <div key={i} className="rounded-lg border border-line bg-surface-overlay/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FlagIcon className="h-4 w-4 text-ink-muted" />
                        <span className="datalabel">challenger {String.fromCharCode(65 + i)}</span>
                      </div>
                      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-positive" : "bg-ink-faint"}`} />
                    </div>
                    <div className="mt-2 text-sm text-ink-muted">{live ? "In the ring" : "Warming up"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-5 border-t border-line-soft pt-4 text-xs leading-relaxed text-ink-faint">
            Judged over a rolling 3-day window: revenue first, then cost per conversation, then
            engagement. The winner becomes tomorrow&apos;s champion.
          </p>
        </section>
      )}

      <section className="mt-6">
        <div className="datalabel">verdict history</div>
        {verdicts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No verdicts yet. They appear here as duels resolve.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {verdicts.map((v, i) => (
              <li
                key={i}
                className="flex items-center justify-between border-b border-line-soft py-3 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                    <CrownIcon className="h-3.5 w-3.5 text-accent-bright" />
                  </span>
                  <span className="text-sm text-ink">
                    New champion crowned on{" "}
                    <span className="rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                      {v.metric_used.toUpperCase()}
                    </span>
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xs text-ink-faint">{relativeTime(v.decided_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
