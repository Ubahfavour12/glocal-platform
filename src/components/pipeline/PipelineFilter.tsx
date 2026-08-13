"use client";

import { useMemo, useState } from "react";

export interface PipelineConcept {
  id: string;
  rank: number;
  hook: string;
  beats: string[];
  copyAngle: string;
  cta: string;
  sourcePattern: string | null;
  rendered: boolean;
}

/**
 * Search and filter over the concept pipeline.
 *
 * Fifty concepts is a long scroll anywhere and unusable on a phone, so the list
 * needs a way in. Filtering happens client-side because the whole set is
 * already loaded and fifty rows is nothing: a round trip per keystroke would be
 * slower and worse.
 */
export function PipelineFilter({
  concepts,
  children,
}: {
  concepts: PipelineConcept[];
  children: (visible: PipelineConcept[]) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "rendered" | "scripted">("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return concepts.filter((c) => {
      if (only === "rendered" && !c.rendered) return false;
      if (only === "scripted" && c.rendered) return false;
      if (!q) return true;
      return (
        c.hook.toLowerCase().includes(q) ||
        c.copyAngle.toLowerCase().includes(q) ||
        c.beats.some((b) => b.toLowerCase().includes(q))
      );
    });
  }, [concepts, query, only]);

  const counts = useMemo(
    () => ({
      all: concepts.length,
      rendered: concepts.filter((c) => c.rendered).length,
      scripted: concepts.filter((c) => !c.rendered).length,
    }),
    [concepts],
  );

  const tab = (key: typeof only, label: string) => (
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
        children(visible)
      )}
    </>
  );
}
