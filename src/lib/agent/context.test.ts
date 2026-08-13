import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM, factsToBrief, runwayDays, suggestedQuestions, type AgentFacts } from "./context";

const facts: AgentFacts = {
  businessName: "Marlango Wines",
  category: "wine retail",
  goal: "whatsapp",
  persona: "smart",
  plan: "growth",
  dailyBudgetUsdMinor: 2000,
  walletBalanceUsdMinor: 18420,
  spendTodayUsdMinor: 840,
  salesTodayUsdMinor: 12600,
  clicksToday: 214,
  conceptCount: 50,
  renderedCount: 12,
  duelStatus: "running",
  championCostPerChatUsdMinor: 41,
  lastVerdictMetric: "cost_per_chat",
  awaitingApproval: true,
  recentActivity: ["Judged yesterday's duel", "Added fresh concepts"],
};

describe("runwayDays", () => {
  it("counts whole days at the current budget", () => {
    expect(runwayDays(18420, 2000)).toBe(9);
    expect(runwayDays(0, 2000)).toBe(0);
  });
  it("never returns negative or divides by zero", () => {
    expect(runwayDays(-500, 2000)).toBe(0);
    expect(runwayDays(1000, 0)).toBe(0);
  });
});

describe("factsToBrief", () => {
  it("states money as figures the model cannot misread", () => {
    const brief = factsToBrief(facts);
    expect(brief).toContain("$184.20");
    expect(brief).toContain("9 days of runway");
    expect(brief).toContain("$8.40");
  });

  it("omits optional facts rather than filling them with nulls", () => {
    const brief = factsToBrief({
      ...facts,
      championCostPerChatUsdMinor: null,
      lastVerdictMetric: null,
      recentActivity: [],
    });
    expect(brief).not.toContain("cost per conversation");
    expect(brief).not.toContain("Last verdict");
    expect(brief).not.toContain("Recent activity");
  });

  it("caps recent activity so the brief stays short", () => {
    const brief = factsToBrief({
      ...facts,
      recentActivity: Array.from({ length: 20 }, (_, i) => `event ${i}`),
    });
    expect(brief).toContain("event 5");
    expect(brief).not.toContain("event 6");
  });
});

describe("AGENT_SYSTEM", () => {
  it("forbids inventing numbers and claiming actions", () => {
    // These two rules are the difference between a useful agent and one that
    // confidently lies about someone's money.
    expect(AGENT_SYSTEM).toMatch(/Never invent/i);
    expect(AGENT_SYSTEM).toMatch(/Never say you have done something/i);
    expect(AGENT_SYSTEM).toMatch(/cannot change anything/i);
  });
});

describe("suggestedQuestions", () => {
  it("offers what the data can actually answer", () => {
    const q = suggestedQuestions(facts);
    expect(q).toContain("Which ad is winning?");
    expect(q.length).toBeLessThanOrEqual(4);
  });

  it("asks about runway when the balance is thin, not about raising budget", () => {
    const q = suggestedQuestions({ ...facts, walletBalanceUsdMinor: 4000 });
    expect(q).toContain("How long will my balance last?");
    expect(q).not.toContain("Should I raise my daily budget?");
  });
});
