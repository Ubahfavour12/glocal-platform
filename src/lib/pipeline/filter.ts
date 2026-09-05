/**
 * Filtering the concept pipeline.
 *
 * Pure and separate from the component so it can be tested directly. Fifty
 * concepts is a long scroll anywhere and unusable on a phone, so the list needs
 * a way in; filtering happens in the browser because the whole set is already
 * loaded and fifty rows is nothing. A round trip per keystroke would be slower
 * and worse.
 */

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

export type PipelineTab = "all" | "rendered" | "scripted";

export function filterConcepts(
  concepts: PipelineConcept[],
  query: string,
  tab: PipelineTab,
): PipelineConcept[] {
  const q = query.trim().toLowerCase();
  return concepts.filter((c) => {
    if (tab === "rendered" && !c.rendered) return false;
    if (tab === "scripted" && c.rendered) return false;
    if (!q) return true;
    return (
      c.hook.toLowerCase().includes(q) ||
      c.copyAngle.toLowerCase().includes(q) ||
      c.beats.some((b) => b.toLowerCase().includes(q))
    );
  });
}

export function tabCounts(concepts: PipelineConcept[]): Record<PipelineTab, number> {
  return {
    all: concepts.length,
    rendered: concepts.filter((c) => c.rendered).length,
    scripted: concepts.filter((c) => !c.rendered).length,
  };
}
