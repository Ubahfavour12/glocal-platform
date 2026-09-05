import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settleVerifiedCharge } from "./settle";
import type { VerifiedTransaction } from "./shared";

const activateSubscription = vi.hoisted(() => vi.fn());
const sendReceiptForBusiness = vi.hoisted(() => vi.fn(async () => ({ sent: true })));

vi.mock("@/lib/billing/subscription", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/subscription")>()),
  activateSubscription,
}));
vi.mock("@/lib/billing/receipt", () => ({ sendReceiptForBusiness }));

/** Minimal stand-in for the service-role client: records rpc + insert calls. */
function fakeSupabase(rpcError: string | null = null) {
  // Typed through the generic rather than via named parameters, so
  // `rpc.mock.calls[0][1]` is the rpc's argument object and not `never`.
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<unknown>>(
    async () => ({ data: null, error: rpcError ? { message: rpcError } : null }),
  );
  const insert = vi.fn(async () => ({ error: null }));
  const client = { rpc, from: vi.fn(() => ({ insert })) };
  return { client: client as unknown as SupabaseClient, rpc, insert };
}

const topup = (over: Partial<VerifiedTransaction> = {}): VerifiedTransaction => ({
  id: 302961,
  txRef: "topup-abcd1234-1",
  status: "successful",
  amountLocalMinor: 10_815_000,
  currency: "NGN",
  meta: { business_id: "b-1", usd_minor: 7000, fx_rate: 1545 },
  ...over,
});

const subscription = (over: Partial<VerifiedTransaction> = {}): VerifiedTransaction => ({
  id: 400001,
  txRef: "sub-abcd1234-1",
  status: "successful",
  // $99 Growth at rate 1545 → ₦152,955.00
  amountLocalMinor: 15_295_500,
  currency: "NGN",
  meta: { business_id: "b-1", purpose: "subscription", tier: "growth", fx_rate: 1545 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wallet top-ups", () => {
  it("credits the floored USD amount computed at the quoted rate", async () => {
    const { client, rpc } = fakeSupabase();
    const outcome = await settleVerifiedCharge(client, "paystack", topup(), {
      sendReceipts: true,
    });

    expect(outcome).toEqual({ kind: "credited", usdMinor: 7000 });
    expect(rpc).toHaveBeenCalledWith("record_psp_topup", {
      p_business_id: "b-1",
      p_usd_minor: 7000,
      p_local_minor: 10_815_000,
      p_local_currency: "NGN",
      p_fx_rate: 1545,
      p_psp_ref: "ps-302961",
    });
  });

  it("tags the credit with the rail it came from", async () => {
    const { client, rpc } = fakeSupabase();
    await settleVerifiedCharge(client, "flutterwave", topup(), { sendReceipts: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_psp_ref: "flw-302961" });
  });

  it("never over-credits: a kobo short rounds down", async () => {
    const { client, rpc } = fakeSupabase();
    await settleVerifiedCharge(client, "paystack", topup({ amountLocalMinor: 10_814_999 }), {
      sendReceipts: false,
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_usd_minor: 6999 });
  });

  it("propagates a ledger failure so the webhook 500s and the PSP retries", async () => {
    const { client } = fakeSupabase("wallet locked");
    await expect(
      settleVerifiedCharge(client, "paystack", topup(), { sendReceipts: true }),
    ).rejects.toThrow(/wallet locked/);
  });
});

describe("receipts are sent once, by the webhook only", () => {
  it("emails when the webhook settles", async () => {
    const { client } = fakeSupabase();
    await settleVerifiedCharge(client, "paystack", topup(), { sendReceipts: true });
    expect(sendReceiptForBusiness).toHaveBeenCalledWith(
      expect.anything(),
      "b-1",
      { type: "topup", amountUsdMinor: 7000 },
    );
  });

  it("stays silent on the redirect path, so one payment is not emailed twice", async () => {
    const { client, rpc } = fakeSupabase();
    await settleVerifiedCharge(client, "paystack", topup(), { sendReceipts: false });
    expect(rpc).toHaveBeenCalledTimes(1); // still credited
    expect(sendReceiptForBusiness).not.toHaveBeenCalled();
  });
});

describe("subscriptions", () => {
  it("activates the tier when the payment covers it", async () => {
    const { client } = fakeSupabase();
    const outcome = await settleVerifiedCharge(client, "paystack", subscription(), {
      sendReceipts: true,
    });

    expect(outcome).toEqual({ kind: "subscribed", tier: "growth" });
    expect(activateSubscription).toHaveBeenCalledWith(expect.anything(), "b-1", "growth");
    expect(sendReceiptForBusiness).toHaveBeenCalledWith(expect.anything(), "b-1", {
      type: "subscription",
      tier: "growth",
      amountUsdMinor: 9900,
    });
  });

  it("tolerates a small shortfall from FX rounding and PSP fees", async () => {
    const { client } = fakeSupabase();
    // 1% under the ₦152,955 price — inside the 2% tolerance.
    const outcome = await settleVerifiedCharge(
      client,
      "paystack",
      subscription({ amountLocalMinor: 15_142_545 }),
      { sendReceipts: false },
    );
    expect(outcome.kind).toBe("subscribed");
  });

  it("refuses to unlock an expensive tier for a cheap charge, and records it", async () => {
    const { client, insert } = fakeSupabase();
    // A Starter-sized payment ($39) tagged as Growth.
    const outcome = await settleVerifiedCharge(
      client,
      "paystack",
      subscription({ amountLocalMinor: 6_025_500 }),
      { sendReceipts: true },
    );

    expect(outcome).toEqual({ kind: "ignored", reason: "underpaid" });
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(sendReceiptForBusiness).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "webhook:paystack",
        action: "subscription_underpaid",
        detail: expect.objectContaining({ tier: "growth", expectedUsdMinor: 9900 }),
      }),
    );
  });
});

describe("charges that must not touch the ledger", () => {
  const ignored = async (txn: VerifiedTransaction) => {
    const { client, rpc } = fakeSupabase();
    const outcome = await settleVerifiedCharge(client, "paystack", txn, { sendReceipts: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(activateSubscription).not.toHaveBeenCalled();
    return outcome;
  };

  it("ignores a charge that did not succeed", async () => {
    expect(await ignored(topup({ status: "failed" }))).toEqual({
      kind: "ignored",
      reason: "not successful",
    });
  });

  it("ignores a charge with no business to credit", async () => {
    expect(await ignored(topup({ meta: null }))).toMatchObject({ kind: "ignored" });
    expect(await ignored(topup({ meta: { usd_minor: 7000 } }))).toMatchObject({ kind: "ignored" });
  });

  it("ignores a charge whose tier is not a real tier", async () => {
    expect(
      await ignored(
        subscription({ meta: { business_id: "b-1", purpose: "subscription", tier: "platinum" } }),
      ),
    ).toMatchObject({ kind: "ignored" });
  });

  it("ignores a charge with no quoted rate, rather than guessing one", async () => {
    // Without the rate there is no honest way to say what was bought.
    expect(await ignored(topup({ meta: { business_id: "b-1" } }))).toEqual({
      kind: "ignored",
      reason: "no rate",
    });
    expect(await ignored(topup({ meta: { business_id: "b-1", fx_rate: 0 } }))).toEqual({
      kind: "ignored",
      reason: "no rate",
    });
  });
});
