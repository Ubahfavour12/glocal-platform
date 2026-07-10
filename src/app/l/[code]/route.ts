import { NextRequest, NextResponse } from "next/server";

/**
 * Smart Link redirect — TRD §3.4 / Blueprint tracking engine.
 * Every ad points here. We log the click (with the ad platform's click id)
 * and instantly redirect to the destination: WhatsApp, tel:, or the
 * customer's site with our click id appended.
 *
 * Performance budget: ≤150ms p95 — the redirect must never wait on slow
 * writes, so click logging is fire-and-forget.
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
  void logClick({
    code,
    clickId,
    platformClickId,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.redirect(buildDestination(link, clickId), 302);
}

interface SmartLink {
  destinationKind: "whatsapp" | "call" | "url";
  destination: string;
}

/** DB-backed in Task #3; stub keeps the route shape and tests honest until then. */
async function resolveLink(code: string): Promise<SmartLink | null> {
  if (code === "demo") {
    return { destinationKind: "url", destination: "https://example.com" };
  }
  return null;
}

function buildDestination(link: SmartLink, clickId: string): string {
  switch (link.destinationKind) {
    case "whatsapp":
      // destination holds the phone number; pre-filled message carries our ref
      return `https://wa.me/${link.destination}?text=${encodeURIComponent(
        `Hi! I saw your ad (ref ${clickId.slice(0, 8)})`,
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

async function logClick(event: {
  code: string;
  clickId: string;
  platformClickId: string | null;
  userAgent: string | null;
}): Promise<void> {
  // Task #3 wires this to click_events via the service client.
  console.log("[smart-link click]", JSON.stringify(event));
}
