import { checkRateLimit, retryAfterSeconds } from "@/lib/net/rate-limit";
import { log } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, MODELS } from "@/lib/ai/anthropic";
import { AGENT_SYSTEM, factsToBrief, type AgentFacts } from "@/lib/agent/context";
import { asPlan } from "@/lib/billing/plan";
import { describeActivity, type RawEntry } from "@/lib/dashboard/activity";
import { currentBusiness } from "@/lib/business/current";

export const maxDuration = 60;

/**
 * "Ask the agent": answers questions about this business from its real data.
 *
 * Security: every read below uses the CALLER'S session, so row-level security
 * decides what exists. A customer cannot reach another business's rows however
 * they phrase the question, because the database refuses, not because the
 * prompt says so.
 *
 * This route is READ-ONLY by design. The agent explains and recommends; changes
 * happen on the real screens where there is a confirmation step and an audit
 * trail. That keeps a persuasive model from being a path to spending money.
 */
const MAX_QUESTION_CHARS = 500;

/**
 * Daily question cap. Each answer is roughly 3,000 input + 400 output tokens,
 * about a third of a cent. These ceilings put the worst case at ~5c/day free
 * and ~35c/day paid, which is noise against a subscription but stops a runaway
 * loop or a bored user from becoming a bill.
 */
const DAILY_LIMIT = { free: 15, paid: 100 } as const;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "sign in first" }, { status: 401 });


  // Rate limited because this route spends OUR money on every call. Scoped to
  // the signed-in user so one person's loop cannot lock anyone else out.
  const limit = await checkRateLimit("agentAsk", userData.user.id);
  if (!limit.allowed) {
    log.warn("ratelimit.blocked", { route: "agentAsk", userId: userData.user.id, count: limit.count });
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds("agentAsk")) } },
    );
  }
  const body = (await req.json().catch(() => null)) as { question?: string } | null;
  const question = (body?.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "ask me something" }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: "that question is too long" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The agent is not available right now." },
      { status: 503 },
    );
  }

  const business = await currentBusiness<{ id: string } & Record<string, unknown>>(
    supabase,
    "id, name, category, goal, persona, plan, daily_budget_usd_minor",
  );
  if (!business) {
    return NextResponse.json({ error: "finish onboarding first" }, { status: 404 });
  }

  const bizId = business.id as string;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { data: walletRow } = await supabase
    .from("wallet_balances")
    .select("wallet_id, balance_usd_minor")
    .eq("business_id", bizId)
    .maybeSingle();
  const walletId = walletRow?.wallet_id as string | undefined;

  const [spendRes, salesRes, clicksRes, conceptRes, renderedRes, testRes, verdictRes, approvalRes, journalRes] =
    await Promise.all([
      walletId
        ? supabase
            .from("ledger_entries")
            .select("amount_usd_minor")
            .eq("wallet_id", walletId)
            .eq("kind", "ad_spend")
            .gte("created_at", todayIso)
        : Promise.resolve({ data: [] as { amount_usd_minor: number }[] }),
      supabase
        .from("conversions")
        .select("value_usd_minor")
        .eq("business_id", bizId)
        .gte("created_at", todayIso),
      supabase
        .from("click_events")
        .select("id, smart_links!inner(business_id)", { count: "exact", head: true })
        .eq("smart_links.business_id", bizId)
        .gte("created_at", todayIso),
      supabase.from("concepts").select("id", { count: "exact", head: true }).eq("business_id", bizId),
      supabase
        .from("concepts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", bizId)
        .eq("rendered", true),
      supabase
        .from("ab_tests")
        .select("status")
        .eq("business_id", bizId)
        .order("test_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("verdicts")
        .select("metric_used, ab_tests!inner(business_id)")
        .eq("ab_tests.business_id", bizId)
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("approvals")
        .select("id")
        .eq("business_id", bizId)
        .eq("status", "awaiting")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("journal_entries")
        .select("entry_type, content, created_at")
        .eq("business_id", bizId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const testStatus = testRes.data?.status as string | undefined;
  const facts: AgentFacts = {
    businessName: (business.name as string) ?? "your business",
    category: (business.category as string) ?? "",
    goal: (business.goal as string) ?? "whatsapp",
    persona: (business.persona as string) ?? "smart",
    plan: asPlan(business.plan as string | null) === "paid" ? (business.plan as string) : "free",
    dailyBudgetUsdMinor: Number(business.daily_budget_usd_minor ?? 0),
    walletBalanceUsdMinor: Number(walletRow?.balance_usd_minor ?? 0),
    spendTodayUsdMinor: Math.abs(
      (spendRes.data ?? []).reduce((s, r) => s + Number(r.amount_usd_minor ?? 0), 0),
    ),
    salesTodayUsdMinor: (salesRes.data ?? []).reduce(
      (s, r) => s + Number(r.value_usd_minor ?? 0),
      0,
    ),
    clicksToday: clicksRes.count ?? 0,
    conceptCount: conceptRes.count ?? 0,
    renderedCount: renderedRes.count ?? 0,
    duelStatus: testStatus === "pending" ? "running" : testStatus === "decided" ? "decided" : "none",
    championCostPerChatUsdMinor: null,
    lastVerdictMetric: (verdictRes.data?.metric_used as string) ?? null,
    awaitingApproval: Boolean(approvalRes.data),
    recentActivity: (journalRes.data ?? []).map((e) => describeActivity(e as RawEntry)),
  };

  // Cap usage per day, and leave an audit trail of what was asked.
  const planTier = asPlan(business.plan as string | null);
  const { count: askedToday } = await supabase
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("business_id", bizId)
    .contains("content", { action: "agent_question" })
    .gte("created_at", todayIso);

  if ((askedToday ?? 0) >= DAILY_LIMIT[planTier]) {
    return NextResponse.json(
      {
        error:
          planTier === "free"
            ? "That is all the questions I can take today. Upgrade for many more."
            : "That is all the questions I can take today. Back tomorrow.",
      },
      { status: 429 },
    );
  }

  try {
    const answer = await callClaude({
      model: MODELS.smart,
      system: AGENT_SYSTEM,
      user: `THIS BUSINESS'S CURRENT DATA\n${factsToBrief(facts)}\n\nOWNER'S QUESTION\n${question}`,
      maxTokens: 500,
    });
    // Log the question, never the answer: this is a usage counter and an audit
    // trail, not a transcript store.
    await supabase.from("journal_entries").insert({
      business_id: bizId,
      entry_type: "note",
      content: { action: "agent_question", detail: { question: question.slice(0, 200) } },
    });

    return NextResponse.json({ answer: answer.trim() });
  } catch {
    return NextResponse.json(
      { error: "I could not reach my reasoning just now. Try again in a moment." },
      { status: 502 },
    );
  }
}
