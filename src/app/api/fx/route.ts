import { NextRequest, NextResponse } from "next/server";
import { effectiveRate, localCostForUsd } from "@/lib/money/fx";
import { fetchUsdRate } from "@/lib/money/rates";

/**
 * The wallet UI's "final price" source (Blueprint §5.2): market rate is
 * internal; customers only ever see the buffered effective rate.
 * GET /api/fx?currency=NGN&usd_minor=7000
 */
export async function GET(req: NextRequest) {
  const currency = req.nextUrl.searchParams.get("currency") ?? "NGN";
  const usdMinor = Number(req.nextUrl.searchParams.get("usd_minor") ?? "0");

  try {
    const snapshot = await fetchUsdRate(currency);
    const body: Record<string, unknown> = {
      currency: snapshot.quote,
      effective_rate: effectiveRate(snapshot),
      fetched_at: snapshot.fetchedAt.toISOString(),
    };
    if (Number.isInteger(usdMinor) && usdMinor > 0) {
      body.usd_minor = usdMinor;
      body.local_minor = localCostForUsd(usdMinor, snapshot);
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fx unavailable" },
      { status: 502 },
    );
  }
}
