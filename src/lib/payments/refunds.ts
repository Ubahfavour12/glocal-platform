/**
 * Sending the refunds a withdrawal is made of.
 *
 * A withdrawal is allocated across the top-ups that funded it; this turns each
 * allocation into a real refund on the rail that took the original payment.
 *
 * The claim/record split is what keeps it safe. `claim_refund_allocation`
 * moves a row to 'sending' before the PSP is called, so a crashed process or an
 * overlapping cron finds it already claimed rather than paying twice. A row
 * left in 'sending' is never retried automatically: nobody can tell from here
 * whether the PSP received that call, and a double refund is worse than one
 * that waits for a person.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { refund as refundOnRail } from "./provider";

export interface ClaimedRefund {
  allocation_id: string;
  psp_ref: string;
  amount_usd_minor: number;
  fx_rate: number | null;
  local_currency: string | null;
}

/**
 * Local-currency minor units to return for a USD amount, at the rate the
 * customer originally paid.
 *
 * Floored, so a refund can never exceed what was actually handed over. The most
 * this loses is one minor unit -- a kobo -- and erring the other way would mean
 * refunding more than was paid, which the PSP would reject anyway.
 */
export function refundLocalMinor(usdMinor: number, fxRate: number): number {
  if (!Number.isInteger(usdMinor) || usdMinor <= 0) {
    throw new Error("refund usd amount must be a positive integer of minor units");
  }
  if (!(fxRate > 0)) throw new Error("fx rate must be positive");
  return Math.floor(usdMinor * fxRate);
}

export type RefundOutcome =
  | { kind: "idle" }
  | { kind: "refunded"; allocationId: string; refundRef: string }
  | { kind: "failed"; allocationId: string; reason: string };

/**
 * Send at most one refund. Returns "idle" when there is nothing waiting.
 *
 * One at a time on purpose: each is a real movement of someone's money, and a
 * loop that fails halfway through a batch is far harder to reason about than a
 * job that does one thing and is run again.
 */
export async function sendNextRefund(supabase: SupabaseClient): Promise<RefundOutcome> {
  const { data, error } = await supabase.rpc("claim_refund_allocation");
  if (error) throw new Error(error.message);

  const claimed = (data as ClaimedRefund[] | null)?.[0];
  if (!claimed) return { kind: "idle" };

  const fail = async (reason: string): Promise<RefundOutcome> => {
    await supabase.rpc("record_refund_result", {
      p_allocation_id: claimed.allocation_id,
      p_status: "failed",
      p_failure_reason: reason.slice(0, 500),
    });
    return { kind: "failed", allocationId: claimed.allocation_id, reason };
  };

  const rate = Number(claimed.fx_rate);
  if (!(rate > 0)) {
    // Without the original rate there is no honest local amount to send back.
    return fail("original payment has no recorded fx rate");
  }

  try {
    const { refundRef } = await refundOnRail(
      claimed.psp_ref,
      refundLocalMinor(claimed.amount_usd_minor, rate),
    );
    await supabase.rpc("record_refund_result", {
      p_allocation_id: claimed.allocation_id,
      p_status: "refunded",
      p_refund_ref: refundRef,
    });
    return { kind: "refunded", allocationId: claimed.allocation_id, refundRef };
  } catch (e) {
    return fail((e as Error).message);
  }
}
