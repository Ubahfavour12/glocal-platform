import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { log, requestId } from "@/lib/log";
import { extractRefCode } from "@/lib/tracking/attribution";
import { currentBusiness } from "@/lib/business/current";

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
    /**
     * A pasted WhatsApp message, or the bare ref code from one. This is how a
     * WhatsApp lead gets ATTRIBUTED rather than merely recorded.
     */
    ref?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  // Adding a lead by hand.
  //
  // WHY THERE IS NO LEAD PER CLICK. A WhatsApp smart link could create a lead
  // the moment it is tapped, and it would be wrong. Most people who tap a
  // wa.me link never send the message, so a lead per click floods the list
  // with people who were never leads — and since lead counts feed cost-per-won,
  // it would corrupt the very quality signal this feature exists to produce.
  //
  // Instead the owner pastes the message they actually received. The prefilled
  // text carries "(ref GL-XXXXXX)", so a real message attributes itself to the
  // exact ad that produced it. A human confirms something happened; the machine
  // does the attribution. Someone who typed their own message has no code, and
  // the lead is recorded unattributed rather than guessed at.
  if (!body.leadId) {
    const business = await currentBusiness<{ id: string } & Record<string, unknown>>(
    supabase,
    "id",
  );
    if (!business) return NextResponse.json({ error: "no business" }, { status: 404 });

    const code = body.ref ? extractRefCode(body.ref) ?? body.ref.trim().toUpperCase() : null;

    let smartLinkId: string | null = null;
    let adId: string | null = null;
    let creativeId: string | null = null;

    if (code) {
      const { data: link } = await supabase
        .from("smart_links")
        .select("id, ad_id, ads(creative_id)")
        .eq("business_id", business.id)
        .eq("code", code)
        .maybeSingle();
      if (link) {
        smartLinkId = link.id as string;
        adId = (link.ad_id as string | null) ?? null;
        creativeId =
          (link.ads as unknown as { creative_id: string | null } | null)?.creative_id ?? null;
      }
    }

    const { data, error } = await supabase
      .from("leads")
      .insert({
        business_id: business.id,
        // Attributed when a code resolved, manual when it did not. The source
        // is the truth about where it came from, not about how it was typed in.
        source: smartLinkId ? "whatsapp" : "manual",
        // A resolved ref code came from text the sender could have edited or
        // deleted, so it is recorded as a hint rather than as evidence.
        attribution: smartLinkId ? "prefill" : "manual",
        smart_link_id: smartLinkId,
        ad_id: adId,
        creative_id: creativeId,
        label: (body.label ?? "").trim().slice(0, 80) || "Lead",
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ lead: data, attributed: Boolean(smartLinkId) });
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
