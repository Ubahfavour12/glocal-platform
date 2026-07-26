import { NextRequest, NextResponse } from "next/server";
import { parseAdRejections, verifyMetaSignature } from "@/lib/quarantine/webhook";
import { handleRejection, type Strike } from "@/lib/quarantine/rejection";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Meta webhook, ad review events (Blueprint §6.2 post-rejection loop).
 * GET  = subscription handshake (hub.challenge echo, gated by verify token).
 * POST = signed change notifications; DISAPPROVED ads flow through
 *        classifyRejection → strike accounting → quarantine, all recorded.
 *
 * The webhook body is authenticated with X-Hub-Signature-256 over the RAW
 * body. Events for ads we don't know are acknowledged and skipped (Meta
 * retries on non-200, and unknown ads are not an error condition).
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

  const events = parseAdRejections(payload);
  if (events.length === 0) return NextResponse.json({ received: true, processed: 0 });

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

  return NextResponse.json({ received: true, processed });
}
