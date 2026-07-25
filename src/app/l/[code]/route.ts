import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildWhatsappPrefill } from "@/lib/tracking/attribution";

/**
 * Smart Link redirect — TRD §3.4, DB-backed as of Phase 2.2.
 * Every ad points here. One indexed lookup resolves the destination, the
 * click is logged fire-and-forget, and the visitor is redirected instantly.
 *
 * WhatsApp destinations carry the ad's REF CODE in the prefilled first
 * message (attribution.buildWhatsappPrefill), which is how a later sale is
 * tied back to the exact ad. Performance budget: ≤150ms p95 — the redirect
 * never waits on the write.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const link = await resolveLink(code);
  if (!link) {
    return NextResponse.redirect(new URL("/", req.url), 302);
  }

  const clickId = crypto.randomUUID();
  // Ad-network click refs arrive as query params (Meta: fbclid, TikTok: ttclid).
  const platformClickId =
    req.nextUrl.searchParams.get("fbclid") ??
    req.nextUrl.searchParams.get("ttclid") ??
    req.nextUrl.searchParams.get("gclid");

  // Fire-and-forget: never block the redirect on the write.
  void logClick(link.id, { clickId, platformClickId, userAgent: req.headers.get("user-agent") });

  return NextResponse.redirect(buildDestination(link, code, clickId), 302);
}

interface SmartLink {
  id: string;
  code: string;
  destinationKind: "whatsapp" | "call" | "url";
  destination: string;
}

async function resolveLink(code: string): Promise<SmartLink | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("smart_links")
      .select("id, code, destination_kind, destination")
      .eq("code", code)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      code: data.code as string,
      destinationKind: data.destination_kind as SmartLink["destinationKind"],
      destination: data.destination as string,
    };
  } catch {
    return null; // resolution failure = soft 302 home, never a crash page
  }
}

function buildDestination(link: SmartLink, code: string, clickId: string): string {
  switch (link.destinationKind) {
    case "whatsapp":
      // destination holds wa.me digits; the prefilled message carries the
      // ad's ref code so the seller can attribute the sale to this exact ad
      return `https://wa.me/${link.destination}?text=${encodeURIComponent(
        buildWhatsappPrefill(code),
      )}`;
    case "call":
      return `tel:${link.destination}`;
    case "url": {
      const url = new URL(link.destination);
      url.searchParams.set("app_cid", clickId);
      return url.toString();
    }
  }
}

async function logClick(
  smartLinkId: string,
  event: { clickId: string; platformClickId: string | null; userAgent: string | null },
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("click_events").insert({
      smart_link_id: smartLinkId,
      platform_click_id: event.platformClickId,
      user_agent: event.userAgent?.slice(0, 300) ?? null,
      app_cid: event.clickId, // pixel matches a later purchase back via this
    });
  } catch {
    // click logging must never break the redirect path
  }
}
