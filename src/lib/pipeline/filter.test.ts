import { describe, expect, it } from "vitest";
import { filterConcepts, tabCounts, type PipelineConcept } from "./filter";

const concept = (over: Partial<PipelineConcept> = {}): PipelineConcept => ({
  id: "c1",
  rank: 1,
  hook: "Pour something worth the evening",
  beats: ["Bottle lands on the table", "Glass fills in slow motion"],
  copyAngle: "Lagos dinner parties deserve better wine",
  cta: "Order today",
  sourcePattern: null,
  rendered: false,
  ...over,
});

const set: PipelineConcept[] = [
  concept({ id: "a", rank: 1, rendered: true }),
  concept({ id: "b", rank: 2, hook: "The wine your guests ask about", rendered: false }),
  concept({
    id: "c",
    rank: 3,
    hook: "Nothing here matches",
    beats: ["Unrelated"],
    copyAngle: "Unrelated",
    rendered: false,
  }),
];

describe("filterConcepts — tabs", () => {
  it("returns everything on 'all'", () => {
    expect(filterConcepts(set, "", "all")).toHaveLength(3);
  });

  it("splits rendered from scripted, with nothing lost between them", () => {
    const rendered = filterConcepts(set, "", "rendered");
    const scripted = filterConcepts(set, "", "scripted");
    expect(rendered.map((c) => c.id)).toEqual(["a"]);
    expect(scripted.map((c) => c.id)).toEqual(["b", "c"]);
    expect(rendered.length + scripted.length).toBe(set.length);
  });
});

describe("filterConcepts — search", () => {
  it("matches the hook, case-insensitively", () => {
    expect(filterConcepts(set, "GUESTS", "all").map((c) => c.id)).toEqual(["b"]);
  });

  it("matches the copy angle and the storyboard beats too", () => {
    expect(filterConcepts(set, "lagos", "all").map((c) => c.id)).toEqual(["a", "b"]);
    expect(filterConcepts(set, "slow motion", "all").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("ignores surrounding whitespace rather than matching nothing", () => {
    expect(filterConcepts(set, "  guests  ", "all").map((c) => c.id)).toEqual(["b"]);
  });

  it("treats an empty query as no filter at all", () => {
    expect(filterConcepts(set, "   ", "all")).toHaveLength(3);
  });

  it("combines the search with the tab", () => {
    expect(filterConcepts(set, "lagos", "rendered").map((c) => c.id)).toEqual(["a"]);
    expect(filterConcepts(set, "lagos", "scripted").map((c) => c.id)).toEqual(["b"]);
  });

  it("returns nothing when nothing matches, rather than falling back to everything", () => {
    expect(filterConcepts(set, "zzzz", "all")).toEqual([]);
  });

  it("never mutates the list it was given", () => {
    const copy = [...set];
    filterConcepts(set, "lagos", "rendered");
    expect(set).toEqual(copy);
  });
});

describe("tabCounts", () => {
  it("counts each tab, and the two halves add up to the whole", () => {
    const counts = tabCounts(set);
    expect(counts).toEqual({ all: 3, rendered: 1, scripted: 2 });
    expect(counts.rendered + counts.scripted).toBe(counts.all);
  });

  it("is all zeroes for an empty pipeline", () => {
    expect(tabCounts([])).toEqual({ all: 0, rendered: 0, scripted: 0 });
  });
});
