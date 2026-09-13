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
 * `record_dev_topup` still exists in the database. Removing it is a migration
 * and a separate decision; what matters is that nothing reachable calls it.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Test top-ups have been removed. Add funds with a card instead." },
    { status: 410 },
  );
}
