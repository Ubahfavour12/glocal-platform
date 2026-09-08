import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendNextRefund } from "@/lib/payments/refunds";

export const maxDuration = 300;

/** Ceiling per run. A queue this long means something is wrong, not busy. */
const MAX_PER_RUN = 20;

/**
 * Send the refunds that outstanding withdrawals are made of.
 *
 * Runs on the cron, CRON_SECRET authenticated like the other jobs. Each refund
 * is claimed before it is sent, so an overlapping run picks up different work
 * rather than paying anyone twice, and a run that dies partway leaves claimed
 * rows for a person to look at instead of retrying blind.
 *
 * Stops at the first failure. A failing rail usually fails for every refund in
 * the queue, and burning through twenty of them turns one problem into twenty
 * rows to unpick by hand.
 *
 * Scheduled daily to match the other jobs, which is slower than a refund
 * deserves -- someone is waiting on their own money. Vercel's Hobby plan caps
 * cron frequency, so hourly needs a paid plan; the route is safe to hit more
 * often the moment that changes, since every refund is claimed before it is
 * sent and overlapping runs take different work.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  let refunded = 0;
  let failure: string | null = null;

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const outcome = await sendNextRefund(supabase);
    if (outcome.kind === "idle") break;
    if (outcome.kind === "failed") {
      failure = outcome.reason;
      break;
    }
    refunded++;
  }

  return NextResponse.json({ refunded, ...(failure ? { stopped_after_failure: failure } : {}) });
}
