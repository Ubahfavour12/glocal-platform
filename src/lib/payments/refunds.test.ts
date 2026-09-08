import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refundLocalMinor, sendNextRefund } from "./refunds";

const refundOnRail = vi.hoisted(() => vi.fn());
vi.mock("./provider", () => ({ refund: refundOnRail }));

type Claimed = {
  allocation_id: string;
  psp_ref: string;
  amount_usd_minor: number;
  fx_rate: number | null;
  local_currency: string | null;
};

/** Fake service client: one claim result, and a record of what was recorded. */
function fakeSupabase(claimed: Claimed | null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args: args ?? {} });
    if (fn === "claim_refund_allocation") {
      return { data: claimed ? [claimed] : [], error: null };
    }
    return { data: null, error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient, calls, rpc };
}

const claimed: Claimed = {
  allocation_id: "alloc-1",
  psp_ref: "ps-302961",
  amount_usd_minor: 7000,
  fx_rate: 1545,
  local_currency: "NGN",
};

const recorded = (calls: { fn: string; args: Record<string, unknown> }[]) =>
  calls.find((c) => c.fn === "record_refund_result")?.args;

beforeEach(() => vi.clearAllMocks());

describe("refundLocalMinor", () => {
  it("converts back at the rate the customer originally paid", () => {
    expect(refundLocalMinor(7000, 1545)).toBe(10_815_000);
  });

  it("floors, so a refund can never exceed what was handed over", () => {
    // 100 * 15.457 = 1545.7 -> 1545, never 1546.
    expect(refundLocalMinor(100, 15.457)).toBe(1545);
  });

  it("refuses a missing or nonsense rate rather than guessing one", () => {
    expect(() => refundLocalMinor(7000, 0)).toThrow();
    expect(() => refundLocalMinor(7000, -1)).toThrow();
    expect(() => refundLocalMinor(0, 1545)).toThrow();
    expect(() => refundLocalMinor(70.5, 1545)).toThrow();
  });
});

describe("sendNextRefund", () => {
  it("does nothing when the queue is empty", async () => {
    const { client } = fakeSupabase(null);
    await expect(sendNextRefund(client)).resolves.toEqual({ kind: "idle" });
    expect(refundOnRail).not.toHaveBeenCalled();
  });

  it("refunds the local amount at the original rate, and records the reference", async () => {
    refundOnRail.mockResolvedValue({ refundRef: "rf-99", psp: "paystack" });
    const { client, calls } = fakeSupabase(claimed);

    const outcome = await sendNextRefund(client);

    expect(refundOnRail).toHaveBeenCalledWith("ps-302961", 10_815_000);
    expect(outcome).toEqual({ kind: "refunded", allocationId: "alloc-1", refundRef: "rf-99" });
    expect(recorded(calls)).toMatchObject({
      p_allocation_id: "alloc-1",
      p_status: "refunded",
      p_refund_ref: "rf-99",
    });
  });

  it("claims before it sends, so a retry cannot pay twice", async () => {
    refundOnRail.mockResolvedValue({ refundRef: "rf-1", psp: "paystack" });
    const { client, calls } = fakeSupabase(claimed);
    await sendNextRefund(client);
    // The claim is the first thing that happens, before any money moves.
    expect(calls[0].fn).toBe("claim_refund_allocation");
  });

  it("marks the allocation failed when the rail refuses, rather than leaving it claimed", async () => {
    refundOnRail.mockRejectedValue(new Error("Paystack /refund: transaction not found"));
    const { client, calls } = fakeSupabase(claimed);

    const outcome = await sendNextRefund(client);

    expect(outcome).toMatchObject({ kind: "failed" });
    expect(recorded(calls)).toMatchObject({ p_status: "failed" });
    expect(String(recorded(calls)?.p_failure_reason)).toMatch(/transaction not found/);
  });

  it("refuses to send when the original payment has no recorded rate", async () => {
    const { client, calls } = fakeSupabase({ ...claimed, fx_rate: null });

    const outcome = await sendNextRefund(client);

    // No honest local amount exists, so nothing is sent at all.
    expect(refundOnRail).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(recorded(calls)).toMatchObject({ p_status: "failed" });
  });

  it("truncates a runaway provider error rather than storing it whole", async () => {
    refundOnRail.mockRejectedValue(new Error("x".repeat(2000)));
    const { client, calls } = fakeSupabase(claimed);
    await sendNextRefund(client);
    expect(String(recorded(calls)?.p_failure_reason).length).toBeLessThanOrEqual(500);
  });
});
