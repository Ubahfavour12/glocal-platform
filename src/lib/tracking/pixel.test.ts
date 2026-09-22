import { describe, expect, it } from "vitest";
import {
  buildPixelJs,
  parseLeadBeacon,
  parsePurchaseParams,
  pixelSnippet,
} from "./pixel";

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

describe("parseLeadBeacon — the site sends what it likes, we keep almost none of it", () => {
  const p = (q: string) => parseLeadBeacon(new URLSearchParams(q));

  it("keeps a first name", () => {
    expect(p("b=biz1&cid=c1&name=Ada")).toMatchObject({ label: "Ada", cid: "c1" });
  });

  it("drops the surname", () => {
    expect(p("b=biz1&name=Ada%20Okoro")).toMatchObject({ label: "Ada" });
  });

  it("REFUSES an email address", () => {
    // The customer's own site calls this and may pass a whole form payload.
    // An email is a contact detail, and this label exists to jog a memory.
    expect(p("b=biz1&name=ada@example.com")).toMatchObject({ label: "Website enquiry" });
  });

  it("REFUSES a phone number", () => {
    expect(p("b=biz1&name=08012347391")).toMatchObject({ label: "Website enquiry" });
  });

  it("falls back to something usable when no name is sent", () => {
    expect(p("b=biz1&cid=c1")).toMatchObject({ label: "Website enquiry" });
  });

  it("caps a very long value", () => {
    const out = p(`b=biz1&name=${"x".repeat(200)}`);
    expect("label" in out && out.label.length).toBeLessThanOrEqual(24);
  });

  it("needs a business code", () => {
    expect(p("name=Ada")).toHaveProperty("error");
  });

  it("treats a missing click id as null rather than empty string", () => {
    expect(p("b=biz1&name=Ada")).toMatchObject({ cid: null });
  });
});
