import { NextRequest, NextResponse } from "next/server";
import { parseAdRejections, verifyMetaSignature } from "@/lib/quarantine/webhook";
import { handleRejection, type Strike } from "@/lib/quarantine/rejection";
import { createServiceClient } from "@/lib/supabase/server";
import { parseLeadgenEvents } from "@/lib/leads/capture";
import { fetchLabel, toLeadRow } from "@/lib/leads/ingest";
import { log } from "@/lib/log";

/**
 * Meta webhook, ad review events (Blueprint §6.2 post-rejection loop).
 * GET  = subscription handshake (hub.challenge echo, gated by verify token).
 * POST = signed change notifications; DISAPPROVED ads flow through
 *        classifyRejection → strike accounting → quarantine, all recorded.
 *
 * The webhook body is authenticated with X-Hub-Signature-256 over the RAW
 * body. Events for ads we don't know are acknowledged and skipped (Meta
 * retries on non-200, and unknown ads are not an error condition).
 *
 * It also receives LEAD FORM submissions, because Meta delivers every
 * subscription for a page to one callback URL. Those are handled here rather
 * than at a second endpoint so there is one signature check and one place that
 * can be got wrong.
 */

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === process.env.META_WEBHOOK_VERIFY_TOKEN &&
    params.get("hub.challenge")
  ) {
    return new NextResponse(params.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: true, processed: 0 });
  }

  // Leads first: the two event kinds arrive on the same endpoint and a payload
  // that carries one carries no instances of the other.
  const leads = await handleLeadgen(payload);

  const events = parseAdRejections(payload);
  if (events.length === 0) {
    return NextResponse.json({ received: true, processed: 0, leads });
  }

  const supabase = createServiceClient();
  const now = new Date();
  let processed = 0;

  for (const event of events) {
    // 1. Find our ad + its business via the campaign.
    const { data: ad } = await supabase
      .from("ads")
      .select("id, campaigns!inner(business_id)")
      .eq("platform_ad_id", event.platformAdId)
      .maybeSingle();
    if (!ad) continue;
    const businessId = (ad.campaigns as unknown as { business_id: string }).business_id;

    // 2. Prior strikes: this business's rejections in the rolling window.
    const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const { data: prior } = await supabase
      .from("rejections")
      .select("created_at, tier, ads!inner(campaigns!inner(business_id))")
      .eq("ads.campaigns.business_id", businessId)
      .gte("created_at", cutoff);
    const priorStrikes: Strike[] = (prior ?? []).map((r) => ({
      at: new Date(r.created_at as string),
      tier: r.tier as Strike["tier"],
    }));

    // 3. Decide, then record everything.
    const outcome = handleRejection(event.reason, priorStrikes, now);
    await supabase.from("rejections").insert({
      ad_id: ad.id,
      platform: "meta",
      reason_code: event.reason || null,
      tier: outcome.tier,
      action_taken: outcome.action === "auto_fix" ? "auto_fixed" : "quarantined",
    });
    await supabase.from("ads").update({ status: "disapproved" }).eq("id", ad.id);
    if (outcome.tier === "hard") {
      await supabase
        .from("ad_accounts")
        .update({ strike_count: outcome.strikeCount, quarantined: outcome.frozen })
        .eq("business_id", businessId)
        .eq("platform", "meta");
    }
    await supabase.from("journal_entries").insert({
      business_id: businessId,
      entry_type: "rejection",
      content: {
        platform_ad_id: event.platformAdId,
        reason: event.reason,
        tier: outcome.tier,
        action: outcome.action,
        strike_count: outcome.strikeCount,
        frozen: outcome.frozen,
        message: outcome.message,
      },
    });
    processed++;
  }

  return NextResponse.json({ received: true, processed, leads });
}

/**
 * Record lead-form submissions.
 *
 * Insert is upsert-on-conflict rather than a read-then-write, because Meta
 * retries until it gets a 200 and two retries can be in flight at once. A
 * check-then-insert loses that race and double-counts the lead, which inflates
 * cost-per-won and sends budget to the wrong creative. The unique index in
 * migration 0034 is what actually settles it; this just asks the database to
 * resolve the conflict instead of failing.
 *
 * Errors are swallowed per lead and logged. A page whose token has expired
 * must not cause a non-200, because Meta would then retry the WHOLE batch,
 * including the ad-rejection events that processed correctly.
 */
async function handleLeadgen(payload: unknown): Promise<number> {
  const events = parseLeadgenEvents(payload);
  if (events.length === 0) return 0;

  const supabase = createServiceClient();
  let stored = 0;

  for (const event of events) {
    try {
      // The ad tells us whose lead this is. Without it we cannot attribute the
      // lead to a business, and an unattributable lead is not ours to keep.
      if (!event.platformAdId) continue;
      const { data: ad } = await supabase
        .from("ads")
        .select("id, creative_id, campaigns!inner(business_id)")
        .eq("platform_ad_id", event.platformAdId)
        .maybeSingle();
      if (!ad) continue;

      const businessId = (ad.campaigns as unknown as { business_id: string }).business_id;

      const { data: conn } = await supabase
        .from("social_connections")
        .select("access_token")
        .eq("business_id", businessId)
        .eq("provider", "meta")
        .maybeSingle();

      const label = conn?.access_token
        ? await fetchLabel(event.leadgenId, conn.access_token as string)
        : null;

      const { error } = await supabase
        .from("leads")
        .upsert(
          toLeadRow(event, businessId, { id: ad.id as string, creative_id: ad.creative_id as string | null }, label),
          { onConflict: "business_id,external_ref", ignoreDuplicates: true },
        );
      if (error) throw error;
      stored++;
    } catch (e) {
      log.error("lead.ingest_failed", {
        leadgenId: event.leadgenId,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return stored;
}
