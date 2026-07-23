import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  buildNicheKeywords,
  buildPipelineBatch,
  conceptRowsFrom,
  PIPELINE_TARGET,
  type PipelineDeps,
} from "./pipeline";
import type { AdConcept } from "./concepts";

const concept = (i: number): AdConcept => ({
  rank: i,
  hook: `Hook ${i}`,
  storyboard: [`shot a`, `shot b`],
  copyAngle: `Copy ${i}`,
  cta: "Message us",
  sourcePattern: `pattern ${i}`,
});

function fakeDeps(over: Partial<PipelineDeps> = {}) {
  const inserted: unknown[][] = [];
  const audits: { action: string; detail: unknown }[] = [];
  const generateCalls: { count: number; avoid: string[]; viralLen: number }[] = [];
  const deps: PipelineDeps = {
    getBusiness: async () => ({
      businessName: "Ada's Fashion",
      category: "Fashion Boutique",
      goal: "whatsapp",
    }),
    countConcepts: async () => 0,
    listExistingHooks: async () => [],
    scrape: async () => [],
    generate: async (_b, viral, count, avoid) => {
      generateCalls.push({ count, avoid, viralLen: viral.length });
      return Array.from({ length: count }, (_, i) => concept(i + 1));
    },
    insertConcepts: async (rows) => {
      inserted.push(rows);
    },
    audit: async (_id, action, detail) => {
      audits.push({ action, detail });
    },
    ...over,
  };
  return { deps, inserted, audits, generateCalls };
}

describe("buildNicheKeywords", () => {
  it("derives quota-sane search terms from the category", () => {
    expect(buildNicheKeywords(" Fashion Boutique ")).toEqual([
      "fashion boutique ad",
      "fashion boutique commercial",
    ]);
  });
});

describe("conceptRowsFrom", () => {
  it("maps concepts to rows with continuing ranks", () => {
    const rows = conceptRowsFrom("biz", [concept(1), concept(2)], 10);
    expect(rows[0]).toMatchObject({ business_id: "biz", rank: 11, hook: "Hook 1" });
    expect(rows[1].rank).toBe(12);
    expect(rows[0].storyboard).toEqual(["shot a", "shot b"]);
  });
});

describe("buildPipelineBatch", () => {
  it("first batch: generates BATCH_SIZE concepts and inserts at rank 1", async () => {
    const { deps, inserted, audits, generateCalls } = fakeDeps();
    const r = await buildPipelineBatch(deps, "biz");
    expect(r).toMatchObject({ status: "built", added: BATCH_SIZE, total: BATCH_SIZE });
    expect(generateCalls[0].count).toBe(BATCH_SIZE);
    expect((inserted[0] as { rank: number }[])[0].rank).toBe(1);
    expect(audits.some((a) => a.action === "pipeline_batch")).toBe(true);
  });

  it("top-up batch: continues ranks and avoids existing hooks", async () => {
    const { deps, inserted, generateCalls } = fakeDeps({
      countConcepts: async () => 20,
      listExistingHooks: async () => ["Old hook A", "Old hook B"],
    });
    const r = await buildPipelineBatch(deps, "biz");
    expect(r.total).toBe(30);
    expect(generateCalls[0].avoid).toEqual(["Old hook A", "Old hook B"]);
    expect((inserted[0] as { rank: number }[])[0].rank).toBe(21);
  });

  it("caps the final batch so the pool never exceeds the target", async () => {
    const { deps, generateCalls } = fakeDeps({ countConcepts: async () => PIPELINE_TARGET - 3 });
    const r = await buildPipelineBatch(deps, "biz");
    expect(generateCalls[0].count).toBe(3);
    expect(r.total).toBe(PIPELINE_TARGET);
  });

  it("full pool short-circuits without touching research or generation", async () => {
    let touched = false;
    const { deps } = fakeDeps({
      countConcepts: async () => PIPELINE_TARGET,
      scrape: async () => {
        touched = true;
        return [];
      },
    });
    const r = await buildPipelineBatch(deps, "biz");
    expect(r.status).toBe("full");
    expect(touched).toBe(false);
  });

  it("scrape failure degrades gracefully: concepts still generate", async () => {
    const { deps, generateCalls } = fakeDeps({
      scrape: async () => {
        throw new Error("quotaExceeded");
      },
    });
    const r = await buildPipelineBatch(deps, "biz");
    expect(r.status).toBe("built");
    expect(generateCalls[0].viralLen).toBe(0);
  });

  it("generation failure returns error status, nothing inserted", async () => {
    const { deps, inserted } = fakeDeps({
      generate: async () => {
        throw new Error("anthropic down");
      },
    });
    const r = await buildPipelineBatch(deps, "biz");
    expect(r.status).toBe("error");
    expect(r.detail).toMatch(/anthropic down/);
    expect(inserted).toHaveLength(0);
  });

  it("unknown business returns error", async () => {
    const { deps } = fakeDeps({ getBusiness: async () => null });
    const r = await buildPipelineBatch(deps, "biz");
    expect(r.status).toBe("error");
  });
});
