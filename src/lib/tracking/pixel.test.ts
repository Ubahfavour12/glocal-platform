import { describe, expect, it } from "vitest";
import { buildPixelJs, parsePurchaseParams, pixelSnippet } from "./pixel";

describe("pixelSnippet", () => {
  it("is a single script tag pointing at the business pixel", () => {
    expect(pixelSnippet("biz-1", "https://glocal.app")).toBe(
      '<script async src="https://glocal.app/px/biz-1.js"></script>',
    );
  });
});

describe("buildPixelJs", () => {
  const js = buildPixelJs("biz-1", "https://glocal.app");
  it("captures app_cid and exposes glocalTrack.purchase", () => {
    expect(js).toContain("app_cid");
    expect(js).toContain("glocal_cid");
    expect(js).toContain("window.glocalTrack");
    expect(js).toContain("/api/track/purchase?b=biz-1");
    expect(js).toContain("sendBeacon");
  });
});

describe("parsePurchaseParams", () => {
  const parse = (q: string) => parsePurchaseParams(new URLSearchParams(q));

  it("parses a full beacon and converts value to minor units", () => {
    const r = parse("b=biz-1&cid=abc&value=49.99&currency=ngn&order=1024");
    expect(r).toEqual({
      businessCode: "biz-1",
      cid: "abc",
      amountMinor: 4999,
      currency: "NGN",
      orderRef: "1024",
    });
  });

  it("defaults currency to USD and cid/order to null", () => {
    const r = parsePurchaseParams(new URLSearchParams("b=biz-1&value=10"));
    expect(r).toMatchObject({ currency: "USD", cid: null, orderRef: null, amountMinor: 1000 });
  });

  it("rejects a missing business code or bad value", () => {
    expect(parse("value=10")).toEqual({ error: "missing business code" });
    expect(parse("b=biz-1&value=0")).toEqual({ error: "invalid value" });
    expect(parse("b=biz-1&value=abc")).toEqual({ error: "invalid value" });
  });
});
