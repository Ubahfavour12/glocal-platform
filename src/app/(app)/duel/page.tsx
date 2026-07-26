import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/dashboard/activity";
import { PageHeader } from "@/components/ui/PageHeader";

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

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label="the duel"
        title="Champion vs challengers"
        subtitle="Two fresh challengers take on your champion every day. A winner is declared only after 24 hours and 5,000 impressions."
        stat={test ? { value: String(1 + Math.max(2, challengerCount)), caption: "ads in the ring" } : undefined}
      />

      {!test ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-muted">
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
                test.status === "decided" ? "bg-accent-soft text-accent-bright" : "bg-surface-overlay text-ink-muted"
              }`}
            >
              {test.status === "decided" ? "verdict in" : "running"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-accent bg-accent-soft p-4">
              <div className="flex items-center gap-2">
                <span className="text-accent-bright">♛</span>
                <div className="datalabel text-accent-bright">champion</div>
              </div>
              <div className="mt-2 text-sm font-medium text-ink">
                {test.champion_ad_id ? "Defending the crown" : "First run"}
              </div>
            </div>
            {Array.from({ length: Math.max(2, challengerCount) }).map((_, i) => (
              <div key={i} className="rounded-lg border border-line bg-surface-overlay/40 p-4">
                <div className="datalabel">challenger {String.fromCharCode(65 + i)}</div>
                <div className="mt-2 text-sm text-ink-muted">{i < challengerCount ? "In the ring" : "Warming up"}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Judged over a rolling 3-day window: revenue first, then cost per conversation, then
            engagement. The winner becomes tomorrow&apos;s champion.
          </p>
        </section>
      )}

      <section className="mt-6">
        <div className="datalabel">verdict history</div>
        {verdicts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No verdicts yet, they appear as duels resolve.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {verdicts.map((v, i) => (
              <li key={i} className="flex items-center justify-between border-b border-line py-3 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-accent-bright">♛</span>
                  <span className="text-sm text-ink">
                    Winner declared on{" "}
                    <span className="font-mono text-ink-muted">{v.metric_used.toUpperCase()}</span>
                  </span>
                </div>
                <span className="font-mono text-xs text-ink-faint">{relativeTime(v.decided_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
