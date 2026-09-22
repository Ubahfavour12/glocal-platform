import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/quarantine/webhook";
import { createServiceClient } from "@/lib/supabase/server";
import { ctwaDedupeKey, ctwaLabel, parseCtwaLeads } from "@/lib/leads/ctwa";
import { log } from "@/lib/log";

/**
 * WhatsApp Cloud API webhook — Click-to-WhatsApp lead attribution.
 *
 * This exists because the other WhatsApp path cannot be trusted. A wa.me link
 * pre-fills "(ref GL-7K4)" into the sender's compose box, where they can edit
 * or delete it, and most people will because it reads like clutter. That makes
 * it a hint, not a measurement.
 *
 * Here, Meta mints a click id when the ad is tapped and attaches it to the
 * first inbound message as a `referral` object, server to server. The sender
 * never sees it and cannot remove it. They can delete every word they typed
 * and the attribution still arrives.
 *
 * INERT UNTIL CONFIGURED. Without WHATSAPP_VERIFY_TOKEN and META_APP_SECRET
 * this endpoint verifies nothing and accepts nothing, which is the correct
 * behaviour for an unconfigured webhook: it is reachable by anyone on the
 * internet, so "no secret" must mean "no", never "allow".
 */

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    token &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === token &&
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
    // Acknowledge, do not retry. Unparseable input will not become parseable.
    return NextResponse.json({ received: true, leads: 0 });
  }

  const leads = parseCtwaLeads(payload);
  if (leads.length === 0) return NextResponse.json({ received: true, leads: 0 });

  const supabase = createServiceClient();
  let stored = 0;

  for (const lead of leads) {
    try {
      // The ad tells us whose lead this is. An ad we do not know is not ours —
      // this endpoint is public, and trusting an arbitrary ad id would let
      // anyone with a valid signature write leads into any business.
      if (!lead.platformAdId) continue;
      const { data: ad } = await supabase
        .from("ads")
        .select("id, creative_id, campaigns!inner(business_id)")
        .eq("platform_ad_id", lead.platformAdId)
        .maybeSingle();
      if (!ad) continue;

      const businessId = (ad.campaigns as unknown as { business_id: string }).business_id;

      const { error } = await supabase.from("leads").upsert(
        {
          business_id: businessId,
          ad_id: ad.id as string,
          creative_id: (ad.creative_id as string | null) ?? null,
          source: "whatsapp",
          // The distinction that matters: Meta's own click id, not text a
          // sender could have edited.
          attribution: "ctwa",
          label: ctwaLabel(lead),
          external_ref: ctwaDedupeKey(lead),
          created_at: lead.receivedAt.toISOString(),
        },
        { onConflict: "business_id,external_ref", ignoreDuplicates: true },
      );
      if (error) throw error;
      stored++;
    } catch (e) {
      // Per lead, so one failure does not cost the rest of the batch. Never a
      // non-200: Meta would retry the whole delivery, including the leads that
      // were written correctly.
      log.error("ctwa.ingest_failed", {
        ad: lead.platformAdId,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ received: true, leads: stored });
}
