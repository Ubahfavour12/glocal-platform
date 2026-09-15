import { NextResponse } from "next/server";

/**
 * RETIRED — the dev top-up route.
 *
 * This credited capped test money straight into a wallet with no payment, which
 * is exactly what you want while building a payments flow and exactly what you
 * must not have once a real customer can reach it. It is how the `ubah` wallet
 * came to hold $10,000 that does not exist.
 *
 * It is answered with 410 Gone rather than deleted outright so that anything
 * still calling it — a cached page, a bookmark, an old client — gets a clear
 * answer instead of a 404 that reads like a routing bug.
 *
 * Retiring this route was NOT enough on its own, and the earlier note here
 * claiming "what matters is that nothing reachable calls it" was wrong.
 * PostgREST publishes every function in `public` that has EXECUTE granted, at
 * /rest/v1/rpc/<name>. `record_dev_topup` was still granted to `authenticated`,
 * so it stayed callable directly with the publishable key in the browser bundle
 * and any signed-in session — this route was never what stood in the way.
 * Migration 0030 revokes EXECUTE from every role, which is what actually closed
 * it. The lesson generalises: deleting a Next.js route does not remove a
 * database function from the API surface.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Test top-ups have been removed. Add funds with a card instead." },
    { status: 410 },
  );
}
