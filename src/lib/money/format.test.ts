import { describe, expect, it } from "vitest";
import { fmtDual, fmtLocal, fmtRoas, fmtUsd } from "./format";

describe("fmtUsd", () => {
  it("formats minor units as USD with thousands", () => {
    expect(fmtUsd(12345)).toBe("$123.45");
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(1_234_567)).toBe("$12,345.67");
  });
});

describe("fmtLocal", () => {
  it("converts USD minor to local via rate (local per USD)", () => {
    expect(fmtLocal(10_000, 1414, "₦")).toBe("₦141,400"); // $100 * 1414
    expect(fmtLocal(7_000, 1414, "₦")).toBe("₦98,980");
  });
});

describe("fmtDual", () => {
  it("appends a local equivalent when a non-USD rate is given", () => {
    expect(fmtDual(10_000, { rate: 1414, symbol: "₦", currency: "NGN" })).toBe(
      "$100.00 (₦141,400)",
    );
  });
  it("shows USD only for USD or no local", () => {
    expect(fmtDual(10_000, { rate: 1, symbol: "$", currency: "USD" })).toBe("$100.00");
    expect(fmtDual(10_000, null)).toBe("$100.00");
  });
});

describe("fmtRoas", () => {
  it("computes return on spend, dash when no spend", () => {
    expect(fmtRoas(40_000, 10_000)).toBe("4.0x");
    expect(fmtRoas(5_000, 0)).toBe("—");
  });
});
