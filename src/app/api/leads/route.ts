import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { log, requestId } from "@/lib/log";

/**
 * Move a lead along, or add one by hand.
 *
 * This is the endpoint behind the weekly review — the one question the whole
 * lead feature exists to ask: "which of these turned into business?"
 *
 * Everything goes through the caller's OWN client, never the service client,
 * so row-level security decides what they may touch. The status change runs
 * inside `set_lead_status`, which keeps the status, the history row and the
 * value rules in one transaction; three client calls would let a dropped
 * request leave a lead whose history disagrees with itself, and the history is
 * what later judges the creatives.
 */

const STATUSES = new Set(["new", "contacted", "qualified", "won", "lost"]);

export async function POST(req: NextRequest) {
  const rid = requestId(req.headers);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    leadId?: string;
    status?: string;
    valueUsdMinor?: number;
    note?: string;
    label?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  // Adding a lead by hand — someone who walked in, or messaged the page.
  // Real business, and deliberately attributed to no creative: it is not
  // evidence about any ad, and pinning it to one would corrupt the comparison.
  if (!body.leadId) {
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!business) return NextResponse.json({ error: "no business" }, { status: 404 });

    const { data, error } = await supabase
      .from("leads")
      .insert({
        business_id: business.id,
        source: "manual",
        label: (body.label ?? "").trim().slice(0, 80) || "Lead",
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ lead: data });
  }

  if (!body.status || !STATUSES.has(body.status)) {
    return NextResponse.json({ error: "unknown status" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("set_lead_status", {
    p_lead_id: body.leadId,
    p_status: body.status,
    p_value_usd_minor:
      body.status === "won" && typeof body.valueUsdMinor === "number"
        ? Math.round(body.valueUsdMinor)
        : null,
    p_note: body.note ?? null,
  });

  if (error) {
    // "A won lead needs its value" is the useful one and must reach the
    // customer as written — it tells them what to do next.
    log.warn("lead.status_refused", { rid, reason: error.message });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ lead: data });
}
