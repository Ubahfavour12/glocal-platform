import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/dashboard/activity";

export const dynamic = "force-dynamic";

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
      <div className="datalabel">the duel</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Champion vs challengers</h1>

      {!test ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="text-sm text-ink-muted">
            No test running yet. The daily A/B duel appears here once your first campaign is live:
            threshold progress, the rolling 3-day window, and the agent&apos;s verdict history.
          </p>
        </div>
      ) : (
        <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
          <div className="flex items-center justify-between">
            <span className="datalabel">today&apos;s duel · {test.test_date}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                test.status === "decided" ? "bg-accent-soft text-accent-bright" : "bg-surface-overlay text-ink-muted"
              }`}
            >
              {test.status === "decided" ? "verdict in" : "running"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-accent/40 bg-accent-soft/30 p-3 text-center">
              <div className="datalabel">champion</div>
              <div className="mt-1 text-sm text-ink">{test.champion_ad_id ? "defending" : "first run"}</div>
            </div>
            {Array.from({ length: Math.max(2, challengerCount) }).map((_, i) => (
              <div key={i} className="rounded-lg border border-line bg-surface-overlay/40 p-3 text-center">
                <div className="datalabel">challenger {String.fromCharCode(65 + i)}</div>
                <div className="mt-1 text-sm text-ink-muted">{i < challengerCount ? "in the ring" : "—"}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-faint">
            A winner is only declared after 24 hours and 5,000 impressions per ad, judged over a
            rolling 3-day window (revenue → cost per conversation → engagement).
          </p>
        </section>
      )}

      <section className="mt-6">
        <div className="datalabel">verdict history</div>
        {verdicts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No verdicts yet — they appear as duels resolve.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {verdicts.map((v, i) => (
              <li key={i} className="flex items-center justify-between border-b border-line py-2.5 last:border-0">
                <span className="text-sm text-ink">
                  Winner declared on <span className="font-mono text-ink-muted">{v.metric_used.toUpperCase()}</span>
                </span>
                <span className="font-mono text-xs text-ink-faint">{relativeTime(v.decided_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
