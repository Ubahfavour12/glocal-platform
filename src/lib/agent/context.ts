/**
 * Grounding for "Ask the agent".
 *
 * The chat answers ONLY from the facts assembled here. Everything is read
 * through the customer's own session, so Postgres row-level security is the
 * boundary, not the prompt: a customer physically cannot retrieve another
 * business's rows no matter how the question is phrased. Prompt instructions
 * are guidance; RLS is the actual security control.
 *
 * Pure formatting so it can be tested without a database.
 */

export interface AgentFacts {
  businessName: string;
  category: string;
  goal: string;
  persona: string;
  plan: string;
  dailyBudgetUsdMinor: number;
  walletBalanceUsdMinor: number;
  spendTodayUsdMinor: number;
  salesTodayUsdMinor: number;
  clicksToday: number;
  conceptCount: number;
  renderedCount: number;
  duelStatus: "none" | "running" | "decided";
  championCostPerChatUsdMinor: number | null;
  lastVerdictMetric: string | null;
  awaitingApproval: boolean;
  recentActivity: string[];
}

const usd = (m: number) => `$${(m / 100).toFixed(2)}`;

/** Whole days of runway at the current daily budget. */
export function runwayDays(balanceUsdMinor: number, dailyBudgetUsdMinor: number): number {
  if (dailyBudgetUsdMinor <= 0) return 0;
  return Math.floor(Math.max(0, balanceUsdMinor) / dailyBudgetUsdMinor);
}

/**
 * Render the facts as a compact block for the model. Deliberately terse: every
 * token here is paid for on every message, and a shorter brief also makes it
 * harder for the model to wander.
 */
export function factsToBrief(f: AgentFacts): string {
  const runway = runwayDays(f.walletBalanceUsdMinor, f.dailyBudgetUsdMinor);
  const lines = [
    `Business: ${f.businessName} (${f.category})`,
    `Goal: ${f.goal} | Scaling persona: ${f.persona} | Plan: ${f.plan}`,
    `Daily budget: ${usd(f.dailyBudgetUsdMinor)}`,
    `Wallet balance: ${usd(f.walletBalanceUsdMinor)} (${runway} days of runway)`,
    `Today: spend ${usd(f.spendTodayUsdMinor)}, ${f.clicksToday} link clicks, verified sales ${usd(f.salesTodayUsdMinor)}`,
    `Concept pipeline: ${f.conceptCount} written, ${f.renderedCount} rendered`,
    `Duel: ${f.duelStatus}`,
  ];
  if (f.championCostPerChatUsdMinor !== null) {
    lines.push(`Champion cost per conversation: ${usd(f.championCostPerChatUsdMinor)}`);
  }
  if (f.lastVerdictMetric) {
    lines.push(`Last verdict decided on: ${f.lastVerdictMetric}`);
  }
  lines.push(`Plan awaiting approval: ${f.awaitingApproval ? "yes" : "no"}`);
  if (f.recentActivity.length > 0) {
    lines.push(`Recent activity: ${f.recentActivity.slice(0, 6).join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * The agent's instructions.
 *
 * Three rules matter more than tone:
 *  - answer only from the brief, and say so plainly when it does not contain
 *    the answer. A confident wrong number about someone's money is worse than
 *    "I cannot tell from your data".
 *  - never claim to have changed anything. This build is read-only; the chat
 *    can explain and recommend, and the customer makes changes on the real
 *    screens where a confirmation step exists.
 *  - refuse anything outside this business.
 */
export const AGENT_SYSTEM = `You are the marketing agent inside Glocal, talking to the small-business owner whose account this is.

WHAT YOU KNOW
You are given a brief of that business's real, current numbers. Answer only from it. If the brief does not contain what was asked, say plainly that you cannot tell from their data yet, and say what would produce that answer (usually: more days of running, or a connected sales source). Never invent or estimate a number you were not given.

WHAT YOU CANNOT DO
You cannot change anything in this conversation. You can explain, interpret and recommend, but budget changes, pausing ads, and plan approvals happen on their own screens where they confirm. If asked to make a change, say what you would do and point them to the screen. Never say you have done something.

REFUSE
Anything about another business, account credentials, payout details, or platform internals. You only discuss this business.

HOW TO TALK
Plain language for someone who is not a marketer. Short. Lead with the answer, then one line of reasoning. Money as figures. No jargon, no bullet lists unless genuinely listing. Never say "as an AI". Be honest about uncertainty rather than reassuring.`;

/** Suggested prompts, chosen to match what the data can actually answer. */
export function suggestedQuestions(f: AgentFacts): string[] {
  const out: string[] = [];
  if (f.duelStatus === "running") out.push("Which ad is winning?");
  if (f.awaitingApproval) out.push("Should I approve tomorrow's plan?");
  const runway = runwayDays(f.walletBalanceUsdMinor, f.dailyBudgetUsdMinor);
  if (runway <= 7) out.push("How long will my balance last?");
  else out.push("Should I raise my daily budget?");
  if (f.salesTodayUsdMinor === 0) out.push("Why no sales today?");
  out.push("What are you doing with my money?");
  return out.slice(0, 4);
}
