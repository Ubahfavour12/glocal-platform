import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { UseThisButton } from "@/components/pipeline/UseThisButton";
import { PipelineFilter, type PipelineConcept } from "@/components/pipeline/PipelineFilter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

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

/** Strip the AI "tells" from generated copy: em/en dashes read as machine-written. */
function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s*[—–]\s*/g, ", ").trim();
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

  const renderedCount = concepts.filter((c) => c.rendered).length;

  // Shape once on the server so the client filter stays a pure list operation.
  const items: PipelineConcept[] = concepts.map((c) => ({
    id: c.id,
    rank: c.rank,
    hook: clean(c.hook),
    beats: (c.storyboard ?? []).filter(Boolean).map(clean),
    copyAngle: clean(c.copy_angle),
    cta: clean(c.cta),
    sourcePattern: c.source_pattern ? clean(c.source_pattern) : null,
    rendered: c.rendered,
  }));

  return (
    <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
      <PageHeader
        label="pipeline"
        title="Concepts, ranked"
        subtitle="Your best-fit ad ideas, reverse-engineered from what's winning in your niche."
        stat={{ value: String(concepts.length), caption: `of 50 · ${renderedCount} rendered` }}
      />

      {concepts.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-muted">
            Your concept library builds here right after onboarding. The research agent studies the
            most viral ads in your niche and turns them into 50 ranked, scripted ideas. Only the two
            entering each day&apos;s test get rendered, so you always see what&apos;s coming next.
          </p>
        </div>
      ) : (
        <PipelineFilter concepts={items}>
          {(visible) => (
        <div className="mt-4 flex flex-col gap-3">
          {visible.map((c) => {
            const beats = c.beats;
            return (
              <article
                key={c.id}
                className="rounded-card border border-line bg-surface-raised p-5 transition-colors hover:border-ink-faint"
              >
                <div className="flex items-start gap-4">
                  {/* rank medallion, accent for the top three */}
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold ${
                      c.rank <= 3 ? "bg-accent text-white" : "bg-surface-overlay text-ink-muted"
                    }`}
                  >
                    {c.rank}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[15px] font-semibold leading-snug text-ink">{c.hook}</h3>
                      <span
                        className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${
                          c.rendered
                            ? "bg-accent-soft text-accent-bright"
                            : "bg-surface-overlay text-ink-faint"
                        }`}
                      >
                        {c.rendered ? "rendered" : "scripted"}
                      </span>
                    </div>

                    {c.copyAngle && (
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{c.copyAngle}</p>
                    )}

                    {beats.length > 0 && (
                      <ol className="mt-4 flex flex-col gap-2 border-l border-line pl-4">
                        {beats.map((beat, i) => (
                          <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                            <span className="datalabel shrink-0 pt-0.5">shot {i + 1}</span>
                            <span>{beat}</span>
                          </li>
                        ))}
                      </ol>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-bright">
                        {c.cta}
                      </span>
                      {c.sourcePattern && (
                        <span className="text-xs text-ink-faint">Borrows {c.sourcePattern}</span>
                      )}
                      {business && !c.rendered && (
                        <span className="ml-auto">
                          <UseThisButton businessId={business.id as string} conceptId={c.id} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
          )}
        </PipelineFilter>
      )}
    </div>
  );
}
