import { describe, expect, it } from "vitest";
import {
  checkWithdrawal,
  MIN_WITHDRAWAL_USD_MINOR,
  REFUSAL_MESSAGE,
  withdrawableUsdMinor,
  type WithdrawalRefusal,
} from "./withdrawal";

const check = (over: Partial<Parameters<typeof checkWithdrawal>[0]> = {}) =>
  checkWithdrawal({
    amountUsdMinor: 5000,
    balanceUsdMinor: 10_000,
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

  it("needs no bank details at all, which is the safety property", () => {
    // Nothing to mistype, nothing stored, nothing an attacker can redirect:
    // the money can only go back to the card that paid it.
    expect(check()).toEqual({ ok: true });
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
    ];
    for (const r of reasons) {
      expect(REFUSAL_MESSAGE[r].length).toBeGreaterThan(10);
    }
  });
});
