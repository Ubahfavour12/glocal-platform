import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Launch an approved plan immediately.
 *
 * The launch cron runs once a day, so "launch now" cannot wait for it: on a
 * daily schedule, choosing now could mean waiting until tomorrow morning, which
 * is the opposite of what the customer asked for. Instead this marks the plan
 * due right now and triggers the launcher directly.
 *
 * Ownership is checked with the caller's own session before any service-role
 * work happens. Ads still land PAUSED, exactly as the cron leaves them, so this
 * changes the timing and nothing about the safety.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { approval_id?: string } | null;
  if (!body?.approval_id) {
    return NextResponse.json({ error: "approval_id required" }, { status: 400 });
  }

  // RLS: this only finds the approval when the caller owns the business.
  const { data: approval } = await supabase
    .from("approvals")
    .select("id, status, launched_at")
    .eq("id", body.approval_id)
    .maybeSingle();
  if (!approval) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (approval.status !== "approved") {
    return NextResponse.json({ error: "approve the plan first" }, { status: 400 });
  }
  if (approval.launched_at) {
    return NextResponse.json({ ok: true, alreadyLaunched: true });
  }

  const service = createServiceClient();
  await service
    .from("approvals")
    .update({ scheduled_for: new Date().toISOString() })
    .eq("id", approval.id);

  // Ask the launcher to run. It re-reads the queue and honours every guard
  // (paywall, provisioning, payment method), so nothing is bypassed by coming
  // through this door instead of the cron.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured: the plan is still marked due, so the next scheduled
    // run picks it up. Say so rather than implying it went live.
    return NextResponse.json({ ok: true, launched: false, queued: true });
  }

  try {
    const res = await fetch(`${req.nextUrl.origin}/api/jobs/launch`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    return NextResponse.json({ ok: true, launched: res.ok, queued: !res.ok });
  } catch {
    return NextResponse.json({ ok: true, launched: false, queued: true });
  }
}
