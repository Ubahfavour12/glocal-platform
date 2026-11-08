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
  // Which table each insert went to. The fee lands in `payment_fees` and must
  // never land in `ledger_entries`, so the table name is the assertion.
  const tables: string[] = [];
  const client = {
    rpc,
    from: vi.fn((table: string) => {
      tables.push(table);
      return { insert };
    }),
  };
  return { client: client as unknown as SupabaseClient, rpc, insert, tables };
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
    // Asserts the CREDIT happened, not how many RPCs were made. The count
    // version broke the moment invoicing added a second call, which told us
    // nothing about whether the money landed -- the only thing this test
    // cares about.
    expect(rpc).toHaveBeenCalledWith("record_psp_topup", expect.anything());
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
      amountUsdMinor: 3900,
    });
  });

  it("tolerates a small shortfall from FX rounding", async () => {
    const { client } = fakeSupabase();
    // Comfortably over the repriced $39 Growth, so it settles. Once said "FX
    // rounding and PSP fees"; the fee half is no longer tolerated silently,
    // it is recorded -- see the tests below.
    const outcome = await settleVerifiedCharge(
      client,
      "paystack",
      subscription({ amountLocalMinor: 15_142_545 }),
      { sendReceipts: false },
    );
    expect(outcome.kind).toBe("subscribed");
  });

  it("records the processor's cut against the business, not the wallet", async () => {
    // THE WHOLE POINT. The fee is OUR cost; the ledger is what the CUSTOMER
    // may spend. Writing it as a wallet debit would quietly reduce balances
    // and break the promise printed on the Add Funds screen.
    const { client, insert, tables } = fakeSupabase();
    await settleVerifiedCharge(
      client,
      "paystack",
      topup({ feeLocalMinor: 160_000 }),
      { sendReceipts: false },
    );
    expect(tables).toContain("payment_fees");
    expect(tables).not.toContain("ledger_entries");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: "b-1",
        psp: "paystack",
        fee_local_minor: 160_000,
        // N160,000 at the quoted 1545 rate, ceiled.
        fee_usd_minor: 104,
      }),
    );
  });

  it("records a fee on a subscription charge too", async () => {
    const { client, tables } = fakeSupabase();
    await settleVerifiedCharge(
      client,
      "paystack",
      subscription({ feeLocalMinor: 90_000 }),
      { sendReceipts: false },
    );
    expect(tables).toContain("payment_fees");
  });

  it("records nothing when the rail did not report a fee", async () => {
    // Undefined is not zero. A rail that stays silent leaves a visible gap
    // rather than a row claiming it was free.
    const { client, tables } = fakeSupabase();
    await settleVerifiedCharge(client, "paystack", topup(), { sendReceipts: false });
    expect(tables).not.toContain("payment_fees");
  });

  it("still credits the wallet when the fee record fails", async () => {
    // A charge that credited correctly must never be failed by a cost record:
    // the PSP would retry and the customer would wait on our bookkeeping.
    const { client, rpc } = fakeSupabase();
    (client as unknown as { from: unknown }).from = vi.fn(() => ({
      insert: vi.fn(async () => {
        throw new Error("payment_fees unreachable");
      }),
    }));
    const outcome = await settleVerifiedCharge(
      client,
      "paystack",
      topup({ feeLocalMinor: 160_000 }),
      { sendReceipts: false },
    );
    expect(outcome.kind).toBe("credited");
    expect(rpc).toHaveBeenCalledWith("record_psp_topup", expect.anything());
  });

  it("refuses to unlock an expensive tier for a cheap charge, and records it", async () => {
    const { client, insert } = fakeSupabase();
    // A Spark-sized payment ($5) tagged as Growth ($39). The old version used
    // $39 against a $99 Growth; repricing made that amount exactly cover the
    // tier, so the test was asserting a shortfall that no longer existed.
    const outcome = await settleVerifiedCharge(
      client,
      "paystack",
      subscription({ amountLocalMinor: 772_500 }),
      { sendReceipts: true },
    );

    expect(outcome).toEqual({ kind: "ignored", reason: "underpaid" });
    expect(activateSubscription).not.toHaveBeenCalled();
    expect(sendReceiptForBusiness).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "webhook:paystack",
        action: "subscription_underpaid",
        detail: expect.objectContaining({ tier: "growth", expectedUsdMinor: 3900 }),
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
