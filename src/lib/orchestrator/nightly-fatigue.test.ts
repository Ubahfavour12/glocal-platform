import { describe, expect, it } from "vitest";
import { runNightly, type BusinessContext, type OrchestratorAdapters } from "./nightly";
import type { FatigueInput } from "@/lib/verdicts/fatigue";

const now = new Date("2026-07-21T20:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const ctx: BusinessContext = {
  businessId: "biz_1",
  name: "Ada's Fashion",
  category: "fashion",
  goal: "whatsapp",
  persona: "smart",
  fullAuto: false,
  dailyBudgetUsdMinor: 1000,
  currentChampionBudgetUsdMinor: null,
  storeConnected: false,
  walletBalanceUsdMinor: 10_000,
  countries: ["NG"],
};

function adapters(championState: FatigueInput | null | undefined): {
  adapters: OrchestratorAdapters;
  audits: { action: string; detail: unknown }[];
} {
  const audits: { action: string; detail: unknown }[] = [];
  const a: OrchestratorAdapters = {
    getOpenTestCandidates: async () => [],
    getNextConcepts: async (_b, n) =>
      Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        rank: i + 1,
        hook: "Own the room this weekend",
        copy: "Handmade pieces, delivered in Lagos. Message us to order yours.",
        cta: "Send a message",
      })),
    savePlan: async () => {},
    audit: async (_b, action, detail) => {
      audits.push({ action, detail });
    },
  };
  if (championState !== undefined) {
    a.getChampionState = async () => championState;
  }
  return { adapters: a, audits };
}

describe("nightly fatigue wiring", () => {
  it("fatigued champion sets style_refresh, commentary and audit", async () => {
    const { adapters: a, audits } = adapters({
      championSince: daysAgo(4),
      peakCtr: 0.04,
      currentCtr: 0.02, // 50% decay > 25% threshold
      frequency: 1.5,
    });
    const plan = await runNightly(ctx, a, now);
    expect(plan.styleDirective).toBe("style_refresh");
    expect(plan.commentary.join(" ")).toMatch(/fatigue/i);
    expect(audits.some((x) => x.action === "fatigue")).toBe(true);
  });

  it("healthy champion leaves the directive at none", async () => {
    const { adapters: a, audits } = adapters({
      championSince: daysAgo(3),
      peakCtr: 0.04,
      currentCtr: 0.038,
      frequency: 1.2,
    });
    const plan = await runNightly(ctx, a, now);
    expect(plan.styleDirective).toBe("none");
    expect(audits.some((x) => x.action === "fatigue")).toBe(false);
  });

  it("day-10 backstop fires even with healthy metrics", async () => {
    const { adapters: a } = adapters({
      championSince: daysAgo(11),
      peakCtr: 0.04,
      currentCtr: 0.04,
      frequency: 1.0,
    });
    const plan = await runNightly(ctx, a, now);
    expect(plan.styleDirective).toBe("style_refresh");
  });

  it("no champion or no adapter: directive stays none (backwards compatible)", async () => {
    const { adapters: withNull } = adapters(null);
    expect((await runNightly(ctx, withNull, now)).styleDirective).toBe("none");
    const { adapters: without } = adapters(undefined);
    expect((await runNightly(ctx, without, now)).styleDirective).toBe("none");
  });
});
