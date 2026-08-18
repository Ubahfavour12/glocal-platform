import { describe, expect, it } from "vitest";
import { adEfficiency, formatAgainstOrder, formatCostPerCustomer } from "./efficiency";

describe("adEfficiency", () => {
  it("refuses to divide by a day with no customers", () => {
    // Infinity on a dashboard reads as a bug or a catastrophe. Both are worse
    // than saying "not yet".
    const e = adEfficiency({ spendUsdMinor: 1_000, revenueUsdMinor: 0, customers: 0 });
    expect(e.costPerCustomerUsdMinor).toBeNull();
    expect(e.verdict).toBe("too_early");
    expect(e.note).toMatch(/no customer yet/);
  });

  it("says nothing at all before any money has moved", () => {
    const e = adEfficiency({ spendUsdMinor: 0, revenueUsdMinor: 0, customers: 0 });
    expect(e.note).toMatch(/Nothing spent yet/);
  });

  it("will not call one lucky sale a result", () => {
    const e = adEfficiency({ spendUsdMinor: 1_000, revenueUsdMinor: 5_000, customers: 1 });
    expect(e.costPerCustomerUsdMinor).toBe(1_000);
    expect(e.verdict).toBe("too_early");
    expect(e.note).toMatch(/I need 3 before/);
  });

  it("calls a genuinely profitable run profitable", () => {
    // $30 spent, 6 customers, $150 revenue: $5 to win someone worth $25.
    const e = adEfficiency({ spendUsdMinor: 3_000, revenueUsdMinor: 15_000, customers: 6 });
    expect(e.costPerCustomerUsdMinor).toBe(500);
    expect(e.averageOrderUsdMinor).toBe(2_500);
    expect(e.marginPerCustomerUsdMinor).toBe(2_000);
    expect(e.verdict).toBe("profitable");
  });

  it("catches the case that quietly ruins people", () => {
    // Selling well and losing money on every sale: $10 to win a $6 customer.
    const e = adEfficiency({ spendUsdMinor: 4_000, revenueUsdMinor: 2_400, customers: 4 });
    expect(e.verdict).toBe("losing");
    expect(e.note).toMatch(/loses you \$4\.00/);
  });

  it("treats a small gap as level rather than a trend", () => {
    // $10.00 to win a $10.50 customer is noise, not a win worth acting on.
    const e = adEfficiency({ spendUsdMinor: 4_000, revenueUsdMinor: 4_200, customers: 4 });
    expect(e.verdict).toBe("breaking_even");
  });

  it("reports return on spend even before a verdict is possible", () => {
    const e = adEfficiency({ spendUsdMinor: 1_000, revenueUsdMinor: 2_000, customers: 0 });
    expect(e.returnOnSpend).toBe(2);
  });

  it("never returns a negative cost or a NaN", () => {
    const e = adEfficiency({ spendUsdMinor: -50, revenueUsdMinor: -10, customers: -3 });
    expect(e.costPerCustomerUsdMinor).toBeNull();
    expect(Number.isNaN(e.returnOnSpend ?? 0)).toBe(false);
  });
});

describe("display helpers", () => {
  it("shows a dash rather than a fake figure", () => {
    const e = adEfficiency({ spendUsdMinor: 500, revenueUsdMinor: 0, customers: 0 });
    expect(formatCostPerCustomer(e)).toBe("—");
    expect(formatAgainstOrder(e)).toBe("no sales yet");
  });

  it("always pairs the cost with what a customer is worth", () => {
    // The number is meaningless alone: $4 is cheap against $25 and ruinous
    // against $3.
    const e = adEfficiency({ spendUsdMinor: 3_000, revenueUsdMinor: 15_000, customers: 6 });
    expect(formatCostPerCustomer(e)).toBe("$5.00");
    expect(formatAgainstOrder(e)).toBe("vs $25.00 average order");
  });
});
