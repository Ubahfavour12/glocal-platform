import { describe, expect, it } from "vitest";
import { renderReceipt } from "./receipt";

const DATE = "2026-08-04T12:00:00.000Z";

describe("renderReceipt", () => {
  it("renders a subscription receipt with tier + monthly framing", () => {
    const r = renderReceipt({
      type: "subscription",
      businessName: "Gormup Gates",
      amountUsdMinor: 9900,
      tier: "growth",
      dateIso: DATE,
    });
    expect(r.subject).toBe("Your Glocal Growth plan is active");
    expect(r.text).toContain("Gormup Gates");
    expect(r.text).toContain("$99.00 per month");
    expect(r.html).toContain("<p");
  });

  it("renders a top-up receipt with the credited amount and refund note", () => {
    const r = renderReceipt({
      type: "topup",
      businessName: "Gormup Gates",
      amountUsdMinor: 5000,
      dateIso: DATE,
    });
    expect(r.subject).toBe("Your Glocal wallet top-up of $50.00");
    expect(r.text).toContain("$50.00");
    expect(r.text).toContain("refundable");
  });

  it("escapes html-sensitive characters in the business name", () => {
    const r = renderReceipt({
      type: "topup",
      businessName: "A & B <Wines>",
      amountUsdMinor: 1000,
      dateIso: DATE,
    });
    expect(r.html).toContain("A &amp; B &lt;Wines&gt;");
    expect(r.html).not.toContain("<Wines>");
  });
});
