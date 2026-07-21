import { describe, expect, it } from "vitest";
import {
  runNightly,
  type BusinessContext,
  type Concept,
  type NightlyPlan,
  type OrchestratorAdapters,
} from "./nightly";
import type { CandidateMetrics } from "@/lib/verdicts/verdict";

const now = new Date("2026-07-12T18:00:00Z");

const ctx = (over: Partial<BusinessContext> = {}): BusinessContext => ({
  businessId: "biz-1",
  name: "Sample Shop",
  category: "fashion boutique",
  goal: "whatsapp",
  persona: "smart",
  fullAuto: false,
  dailyBudgetUsdMinor: 1000,
  currentChampionBudgetUsdMinor: null,
  storeConnected: false,
  walletBalanceUsdMinor: 7000,
  countries: ["NG"],
  ...over,
});

const concept = (id: string, rank: number, copy = "New styles just landed. Message us!"): Concept => ({
  id,
  rank,
  hook: `hook-${id}`,
  copy,
  cta: "LEARN_MORE",
});

function makeAdapters(over: Partial<OrchestratorAdapters> = {}) {
  const saved: NightlyPlan[] = [];
  const audits: { action: string; detail: unknown }[] = [];
  const adapters: OrchestratorAdapters = {
    getOpenTestCandidates: async () => [] as CandidateMetrics[],
    getNextConcepts: async (_b, count) =>
      Array.from({ length: count }, (_, i) => concept(`c${i + 1}`, i + 1)),
    savePlan: async (p) => {
      saved.push(p);
    },
    audit: async (_b, action, detail) => {
      audits.push({ action, detail });
    },
    ...over,
  };
  return { adapters, saved, audits };
}

describe("runNightly — plan creation", () => {
  it("builds a 70/30 smart-persona plan awaiting approval", async () => {
    const { adapters, saved } = makeAdapters();
    const plan = await runNightly(ctx(), adapters, now);

    expect(plan.status).toBe("ready_for_approval");
    expect(plan.championBudgetUsdMinor).toBe(700);
    expect(plan.challengers.map((c) => c.budgetUsdMinor)).toEqual([150, 150]);
    expect(plan.challengers.map((c) => c.concept.id)).toEqual(["c1", "c2"]);
    expect(saved).toHaveLength(1);
  });

  it("full-auto businesses skip the approval gate", async () => {
    const { adapters } = makeAdapters();
    const plan = await runNightly(ctx({ fullAuto: true }), adapters, now);
    expect(plan.status).toBe("auto_approved");
  });

  it("plans only what the wallet can cover", async () => {
    const { adapters } = makeAdapters();
    const plan = await runNightly(ctx({ walletBalanceUsdMinor: 500 }), adapters, now);
    // spendable = min(1000, 500) → split of 500
    expect(plan.championBudgetUsdMinor + plan.challengers.reduce((s, c) => s + c.budgetUsdMinor, 0)).toBe(500);
    expect(plan.commentary.join(" ")).toMatch(/balance covers less/i);
  });

  it("empty wallet → insufficient_funds plan, nothing scheduled", async () => {
    const { adapters } = makeAdapters();
    const plan = await runNightly(ctx({ walletBalanceUsdMinor: 0 }), adapters, now);
    expect(plan.status).toBe("insufficient_funds");
    expect(plan.challengers).toHaveLength(0);
  });
});

describe("runNightly — the 30% escalation cap is inescapable", () => {
  it("caps champion growth even when the persona split wants more", async () => {
    const { adapters } = makeAdapters();
    // Yesterday champion ran at $2; smart split of $10 wants $7 → capped at $2.60
    const plan = await runNightly(
      ctx({ currentChampionBudgetUsdMinor: 200 }),
      adapters,
      now,
    );
    expect(plan.championBudgetUsdMinor).toBe(260);
    expect(plan.commentary.join(" ")).toMatch(/never increase more than 30%/i);
  });
});

describe("runNightly — gateway integration", () => {
  it("a policy-violating concept is substituted, not launched", async () => {
    const { adapters, audits } = makeAdapters({
      getNextConcepts: async () => [
        concept("bad", 1, "Make $10,000 in a week with this!"),
        concept("good1", 2),
        concept("good2", 3),
      ],
    });
    const plan = await runNightly(ctx(), adapters, now);
    expect(plan.challengers.map((c) => c.concept.id)).toEqual(["good1", "good2"]);
    expect(plan.commentary.join(" ")).toMatch(/rejected one of my own drafts/i);
    const scans = audits.filter((a) => a.action === "gateway_scan");
    expect(scans).toHaveLength(3); // bad + two good
  });

  it("reports a short plan when the pool can't fill both slots cleanly", async () => {
    const { adapters } = makeAdapters({
      getNextConcepts: async () => [
        concept("bad1", 1, "Guaranteed results overnight!"),
        concept("bad2", 2, "Earn ₦900,000 per month from your phone"),
        concept("good1", 3),
      ],
    });
    const plan = await runNightly(ctx(), adapters, now);
    expect(plan.challengers).toHaveLength(1);
    expect(plan.commentary.join(" ")).toMatch(/concept pool needs replenishing/i);
  });
});

describe("runNightly — verdict step", () => {
  it("carries the pending-verdict explanation into commentary", async () => {
    const young: CandidateMetrics[] = [
      {
        adId: "a",
        startedAt: new Date(now.getTime() - 2 * 3_600_000),
        daily: [{ date: now, impressions: 100, clicks: 5, intents: 1, spendUsdMinor: 50, revenueUsdMinor: 0 }],
      },
      {
        adId: "b",
        startedAt: new Date(now.getTime() - 2 * 3_600_000),
        daily: [{ date: now, impressions: 90, clicks: 4, intents: 1, spendUsdMinor: 50, revenueUsdMinor: 0 }],
      },
    ];
    const { adapters } = makeAdapters({ getOpenTestCandidates: async () => young });
    const plan = await runNightly(ctx(), adapters, now);
    expect(plan.verdict?.status).toBe("pending");
    expect(plan.commentary.join(" ")).toMatch(/won't judge on thin data/i);
  });

  it("audits every step of the run", async () => {
    const { adapters, audits } = makeAdapters();
    await runNightly(ctx(), adapters, now);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("gateway_scan");
    expect(actions).toContain("plan_created");
  });
});
