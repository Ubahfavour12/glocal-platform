import { describe, expect, it } from "vitest";
import {
  checkWithdrawal,
  isValidDestination,
  MIN_WITHDRAWAL_USD_MINOR,
  REFUSAL_MESSAGE,
  withdrawableUsdMinor,
  type WithdrawalRefusal,
} from "./withdrawal";

const dest = { bankName: "GTBank", accountNumber: "0123456789", accountName: "Gormup Gates Ltd" };

const check = (over: Partial<Parameters<typeof checkWithdrawal>[0]> = {}) =>
  checkWithdrawal({
    amountUsdMinor: 5000,
    balanceUsdMinor: 10_000,
    destination: dest,
    hasPendingWithdrawal: false,
    ...over,
  });

const refusedFor = (over: Partial<Parameters<typeof checkWithdrawal>[0]>): WithdrawalRefusal => {
  const r = check(over);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
};

describe("withdrawableUsdMinor", () => {
  it("is the balance, and never negative", () => {
    expect(withdrawableUsdMinor(10_000)).toBe(10_000);
    expect(withdrawableUsdMinor(0)).toBe(0);
    // An overdrawn wallet must not present as an owed refund.
    expect(withdrawableUsdMinor(-500)).toBe(0);
  });
});

describe("isValidDestination", () => {
  it("accepts a complete ten-digit NUBAN destination", () => {
    expect(isValidDestination(dest)).toBe(true);
    expect(isValidDestination({ ...dest, accountNumber: " 0123456789 " })).toBe(true);
  });

  it("rejects account numbers that are not exactly ten digits", () => {
    expect(isValidDestination({ ...dest, accountNumber: "012345678" })).toBe(false);
    expect(isValidDestination({ ...dest, accountNumber: "01234567890" })).toBe(false);
    expect(isValidDestination({ ...dest, accountNumber: "01234abcde" })).toBe(false);
    expect(isValidDestination({ ...dest, accountNumber: "" })).toBe(false);
  });

  it("rejects a missing bank or account name", () => {
    expect(isValidDestination({ ...dest, bankName: "" })).toBe(false);
    expect(isValidDestination({ ...dest, accountName: " " })).toBe(false);
    expect(isValidDestination(null)).toBe(false);
    expect(isValidDestination({})).toBe(false);
  });
});

describe("checkWithdrawal — what it allows", () => {
  it("allows a normal withdrawal of part of the balance", () => {
    expect(check()).toEqual({ ok: true });
  });

  it("allows withdrawing the entire balance", () => {
    expect(check({ amountUsdMinor: 10_000, balanceUsdMinor: 10_000 })).toEqual({ ok: true });
  });

  it("allows a whole balance smaller than the minimum, so it is never trapped", () => {
    // Someone with $4 left can still take their $4 out.
    expect(check({ amountUsdMinor: 400, balanceUsdMinor: 400 })).toEqual({ ok: true });
  });
});

describe("checkWithdrawal — what it refuses, and why", () => {
  it("refuses more than the unspent balance", () => {
    expect(refusedFor({ amountUsdMinor: 10_001, balanceUsdMinor: 10_000 })).toBe("exceeds_balance");
  });

  it("refuses a partial withdrawal under the minimum", () => {
    expect(refusedFor({ amountUsdMinor: MIN_WITHDRAWAL_USD_MINOR - 1 })).toBe("below_minimum");
  });

  it("reports an empty wallet as empty, not as below the minimum", () => {
    // "Below the minimum" would imply topping up would help. It would not.
    expect(refusedFor({ amountUsdMinor: 500, balanceUsdMinor: 0 })).toBe("nothing_to_withdraw");
    expect(refusedFor({ amountUsdMinor: 500, balanceUsdMinor: -200 })).toBe("nothing_to_withdraw");
  });

  it("refuses a second request while one is still open", () => {
    // Checked first: it is true regardless of amount or details.
    expect(refusedFor({ hasPendingWithdrawal: true })).toBe("pending_exists");
    expect(refusedFor({ hasPendingWithdrawal: true, amountUsdMinor: -5 })).toBe("pending_exists");
  });

  it("refuses amounts that are not whole cents", () => {
    expect(refusedFor({ amountUsdMinor: 50.5 })).toBe("not_a_number");
    expect(refusedFor({ amountUsdMinor: 0 })).toBe("not_a_number");
    expect(refusedFor({ amountUsdMinor: -100 })).toBe("not_a_number");
    expect(refusedFor({ amountUsdMinor: NaN })).toBe("not_a_number");
  });

  it("refuses bad bank details last, once the amount itself is sound", () => {
    expect(refusedFor({ destination: null })).toBe("bad_destination");
    expect(refusedFor({ destination: { ...dest, accountNumber: "123" } })).toBe("bad_destination");
    // An amount problem is reported before the details, since it is the one
    // the customer is most likely to have got wrong.
    expect(refusedFor({ amountUsdMinor: 99_999, destination: null })).toBe("exceeds_balance");
  });
});

describe("REFUSAL_MESSAGE", () => {
  it("has plain-language wording for every refusal", () => {
    const reasons: WithdrawalRefusal[] = [
      "not_a_number",
      "below_minimum",
      "exceeds_balance",
      "nothing_to_withdraw",
      "pending_exists",
      "bad_destination",
    ];
    for (const r of reasons) {
      expect(REFUSAL_MESSAGE[r].length).toBeGreaterThan(10);
    }
  });
});
