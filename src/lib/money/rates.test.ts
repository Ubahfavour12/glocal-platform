import { describe, expect, it } from "vitest";
import { parseRateResponse } from "./rates";

const now = new Date("2026-07-11T10:00:00Z");

describe("parseRateResponse", () => {
  it("extracts the quote rate into a snapshot", () => {
    const snap = parseRateResponse(
      { result: "success", rates: { NGN: 1502.7, EUR: 0.91 } },
      "ngn",
      now,
    );
    expect(snap).toEqual({ quote: "NGN", rate: 1502.7, fetchedAt: now });
  });

  it("rejects provider errors", () => {
    expect(() => parseRateResponse({ result: "error" }, "NGN", now)).toThrow();
  });

  it("rejects missing or non-positive rates", () => {
    expect(() =>
      parseRateResponse({ result: "success", rates: { EUR: 0.9 } }, "NGN", now),
    ).toThrow();
    expect(() =>
      parseRateResponse({ result: "success", rates: { NGN: 0 } }, "NGN", now),
    ).toThrow();
  });
});
