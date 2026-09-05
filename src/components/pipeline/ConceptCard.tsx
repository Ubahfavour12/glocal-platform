"use client";

import { UseThisButton } from "./UseThisButton";
import type { PipelineConcept } from "@/lib/pipeline/filter";

/**
 * One ranked concept.
 *
 * Lives on the client side of the boundary because the filtered list is
 * computed in the browser. It takes only serialisable props — no callbacks
 * from the server — which is the whole point: see the note in PipelineFilter.
 */
export function ConceptCard({
  concept: c,
  businessId,
  videoAffordable,
  videoCredits,
}: {
  concept: PipelineConcept;
  businessId: string | null;
  videoAffordable: boolean;
  videoCredits: number;
}) {
  return (
    <article className="rounded-card border border-line bg-surface-raised p-5 transition-colors hover:border-ink-faint">
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

          {c.beats.length > 0 && (
            <ol className="mt-4 flex flex-col gap-2 border-l border-line pl-4">
              {c.beats.map((beat, i) => (
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
            {businessId && !c.rendered && (
              <span className="ml-auto">
                <UseThisButton
                  businessId={businessId}
                  conceptId={c.id}
                  videoAffordable={videoAffordable}
                  videoCredits={videoCredits}
                />
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
