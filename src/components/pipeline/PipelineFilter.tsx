"use client";

import { useMemo, useState } from "react";
import { ConceptCard } from "./ConceptCard";
import {
  filterConcepts,
  tabCounts,
  type PipelineConcept,
  type PipelineTab,
} from "@/lib/pipeline/filter";

export type { PipelineConcept } from "@/lib/pipeline/filter";

/**
 * Search and filter over the concept pipeline, and render the result.
 *
 * This component renders the list itself rather than taking a render prop from
 * the page. It used to take `children: (visible) => ReactNode`, which looks
 * natural but cannot work: the page is a Server Component, and a function
 * cannot be serialised across the server/client boundary. React threw
 * "Functions cannot be passed directly to Client Components" and the whole
 * Pipeline page 500'd — but only once a business had concepts, because the
 * empty state returns before reaching this component, which is why it looked
 * intermittent rather than broken.
 *
 * So every prop here is data. Keeping it that way is what keeps the page up.
 */
export function PipelineFilter({
  concepts,
  businessId,
  videoAffordable,
  videoCredits,
}: {
  concepts: PipelineConcept[];
  businessId: string | null;
  videoAffordable: boolean;
  videoCredits: number;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<PipelineTab>("all");

  const visible = useMemo(() => filterConcepts(concepts, query, only), [concepts, query, only]);
  const counts = useMemo(() => tabCounts(concepts), [concepts]);

  const tab = (key: PipelineTab, label: string) => (
    <button
      key={key}
      onClick={() => setOnly(key)}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
        only === key
          ? "border-accent bg-accent-soft text-accent-bright"
          : "border-line text-ink-muted hover:text-ink"
      }`}
    >
      {label} <span className="font-mono">{counts[key]}</span>
    </button>
  );

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search hooks, angles, shots…"
          aria-label="Search concepts"
          className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          {tab("all", "All")}
          {tab("scripted", "Scripted")}
          {tab("rendered", "Rendered")}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-ink-muted">
          Nothing matches that. Try a different word, or clear the filter.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {visible.map((c) => (
            <ConceptCard
              key={c.id}
              concept={c}
              businessId={businessId}
              videoAffordable={videoAffordable}
              videoCredits={videoCredits}
            />
          ))}
        </div>
      )}
    </>
  );
}
