import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ConceptRow {
  id: string;
  rank: number;
  hook: string;
  storyboard: string[] | null;
  copy_angle: string;
  cta: string;
  source_pattern: string | null;
  rendered: boolean;
}

export default async function PipelinePage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const concepts: ConceptRow[] = business
    ? (
        (await supabase
          .from("concepts")
          .select("id, rank, hook, storyboard, copy_angle, cta, source_pattern, rendered")
          .eq("business_id", business.id)
          .order("rank", { ascending: true })).data ?? []
      ) as ConceptRow[]
    : [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="datalabel">pipeline</div>
      <div className="flex items-baseline justify-between">
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Concepts, ranked</h1>
        <span className="datalabel">{concepts.length} / 50</span>
      </div>

      {concepts.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="text-sm text-ink-muted">
            Your concept library builds here right after onboarding — the research agent
            reverse-engineers the most viral ads in your niche into 50 ranked, scripted concepts.
            Each card shows the hook, storyboard beats, and whether it has been rendered for a duel.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {concepts.map((c) => (
            <div key={c.id} className="rounded-card border border-line bg-surface-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-ink-faint">#{c.rank}</span>
                  <p className="text-sm font-medium text-ink">{c.hook}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                    c.rendered
                      ? "bg-accent-soft text-accent-bright"
                      : "bg-surface-overlay text-ink-faint"
                  }`}
                >
                  {c.rendered ? "rendered" : "scripted"}
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{c.copy_angle}</p>
              {c.storyboard && c.storyboard.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.storyboard.slice(0, 4).map((beat, i) => (
                    <span key={i} className="rounded bg-surface-overlay px-2 py-0.5 text-[11px] text-ink-faint">
                      {beat}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-faint">
                <span className="font-mono">CTA: {c.cta}</span>
                {c.source_pattern && <span>· borrows: {c.source_pattern}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
