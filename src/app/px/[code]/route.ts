import { NextRequest, NextResponse } from "next/server";
import { buildPixelJs } from "@/lib/tracking/pixel";

/**
 * Serves the per-business conversion pixel (the code is the business id). The
 * customer pastes one <script> on every page; on the thank-you page they call
 * window.glocalTrack.purchase(value, orderId, currency).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const businessCode = code.replace(/\.js$/i, "");
  const { origin } = new URL(req.url);
  return new NextResponse(buildPixelJs(businessCode, origin), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
