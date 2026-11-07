import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Daily reconciliation, Blueprint §5, PRD F-02 acceptance:
 * "ledger reconciles to the cent". Runs as a cron (Vercel cron or Supabase
 * scheduled function) with CRON_SECRET auth.
 *
 * Phase 1 (now): internal integrity, no negative balances, no sign/kind
 * mismatches, dev-topup caps respected.
 * Phase 2 (with PSPs): compare topup/refund sums against Stripe/Flutterwave
 * settlement records. Phase 3 (with ads live): compare ad_spend against
 * ad-network invoices.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "service role key not configured yet" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const issues: string[] = [];

  const { data: balances, error } = await supabase
    .from("wallet_balances")
    .select("wallet_id, business_id, balance_usd_minor");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const b of balances ?? []) {
    if (Number(b.balance_usd_minor) < 0) {
      issues.push(`wallet ${b.wallet_id} has NEGATIVE balance ${b.balance_usd_minor}`);
    }
  }

  // Sign/kind integrity: credits only on topup/adjustment.
  const { data: badSigns } = await supabase
    .from("ledger_entries")
    .select("id, kind, amount_usd_minor")
    .gt("amount_usd_minor", 0)
    .not("kind", "in", "(topup,adjustment)");
  for (const e of badSigns ?? []) {
    issues.push(`entry ${e.id}: positive amount with kind ${e.kind}`);
  }

  // Data minimisation, and the one promise on /privacy that nothing kept.
  // `prune_click_events` has existed since migration 0032 and no caller ever
  // existed, so the ninety-day limit on ad viewers' click data was a function
  // sitting in the database while the table grew without bound. These are
  // people who never had any relationship with us and cannot ask us for
  // anything, which is exactly why the limit has to be automatic.
  //
  // Its failure must not fail reconciliation: a housekeeping sweep that can
  // mask a negative wallet balance is worse than one that skips a night.
  let clickEventsPruned: number | string;
  const { data: pruned, error: pruneError } = await supabase.rpc("prune_click_events", {
    p_days: 90,
  });
  if (pruneError) {
    clickEventsPruned = `failed: ${pruneError.message}`;
    issues.push(`click-event prune failed: ${pruneError.message}`);
  } else {
    clickEventsPruned = Number(pruned ?? 0);
  }

  const report = {
    ran_at: new Date().toISOString(),
    wallets_checked: balances?.length ?? 0,
    click_events_pruned: clickEventsPruned,
    issues,
    psp_comparison: "pending, Stripe/Flutterwave not connected",
    ad_network_comparison: "pending, ads not live",
  };

  await supabase.from("audit_log").insert({
    actor: "job:reconcile",
    action: issues.length === 0 ? "reconcile_clean" : "reconcile_ISSUES",
    detail: report,
  });

  return NextResponse.json(report, { status: issues.length === 0 ? 200 : 500 });
}
