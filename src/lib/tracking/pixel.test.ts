import { describe, expect, it } from "vitest";
import {
  buildPixelJs,
  parseLeadBeacon,
  MAX_BEACON_SALE_USD_MINOR,
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

// Real ids, because the parsers now refuse anything that is not one.
const BIZ = "0b0e8a52-6f0a-4f3e-9d57-2f1a1c9d7e11";
const CID = "3f2b9c1e-8a4d-4c6f-b1e2-9a7c5d3e1f00";

describe("parsePurchaseParams", () => {
  const parse = (q: string) => parsePurchaseParams(new URLSearchParams(q));

  it("parses a full beacon and converts value to minor units", () => {
    const r = parse(`b=${BIZ}&cid=${CID}&value=49.99&currency=ngn&order=1024`);
    expect(r).toEqual({
      businessCode: BIZ,
      cid: CID,
      amountMinor: 4999,
      currency: "NGN",
      orderRef: "1024",
    });
  });

  it("defaults currency to USD and cid/order to null", () => {
    const r = parsePurchaseParams(new URLSearchParams(`b=${BIZ}&value=10`));
    expect(r).toMatchObject({ currency: "USD", cid: null, orderRef: null, amountMinor: 1000 });
  });

  it("rejects a missing business code or bad value", () => {
    expect(parse("value=10")).toEqual({ error: "missing business code" });
    expect(parse(`b=${BIZ}&value=0`)).toEqual({ error: "invalid value" });
    expect(parse(`b=${BIZ}&value=abc`)).toEqual({ error: "invalid value" });
  });
});

describe("parseLeadBeacon — the site sends what it likes, we keep almost none of it", () => {
  const p = (q: string) => parseLeadBeacon(new URLSearchParams(q));

  it("keeps a first name", () => {
    expect(p(`b=${BIZ}&cid=${CID}&name=Ada`)).toMatchObject({ label: "Ada", cid: CID });
  });

  it("drops the surname", () => {
    expect(p(`b=${BIZ}&name=Ada%20Okoro`)).toMatchObject({ label: "Ada" });
  });

  it("REFUSES an email address", () => {
    // The customer's own site calls this and may pass a whole form payload.
    // An email is a contact detail, and this label exists to jog a memory.
    expect(p(`b=${BIZ}&name=ada@example.com`)).toMatchObject({ label: "Website enquiry" });
  });

  it("REFUSES a phone number", () => {
    expect(p(`b=${BIZ}&name=08012347391`)).toMatchObject({ label: "Website enquiry" });
  });

  it("falls back to something usable when no name is sent", () => {
    expect(p(`b=${BIZ}&cid=${CID}`)).toMatchObject({ label: "Website enquiry" });
  });

  it("caps a very long value", () => {
    const out = p(`b=${BIZ}&name=${"x".repeat(200)}`);
    expect("label" in out && out.label.length).toBeLessThanOrEqual(24);
  });

  it("needs a business code", () => {
    expect(p("name=Ada")).toHaveProperty("error");
  });

  it("treats a missing click id as null rather than empty string", () => {
    expect(p(`b=${BIZ}&name=Ada`)).toMatchObject({ cid: null });
  });
});

describe("beacons refuse what we could not have issued", () => {
  const purchase = (q: string) => parsePurchaseParams(new URLSearchParams(q));
  const lead = (q: string) => parseLeadBeacon(new URLSearchParams(q));

  it("refuses a business code that is not a UUID", () => {
    expect(purchase("b=biz-1&value=10")).toEqual({ error: "invalid business code" });
    expect(purchase("b=1%20or%201=1&value=10")).toEqual({ error: "invalid business code" });
    expect(lead("b=biz-1&name=Ada")).toEqual({ error: "invalid business code" });
  });

  it("treats a click id we could not have minted as no click id", () => {
    // Not an error: a shopper with a stale or mangled id still bought
    // something. It simply cannot be attributed to an ad.
    expect(purchase(`b=${BIZ}&cid=not-a-uuid&value=10`)).toMatchObject({ cid: null });
    expect(lead(`b=${BIZ}&cid=abc&name=Ada`)).toMatchObject({ cid: null });
  });

  it("refuses a currency that is not three letters", () => {
    expect(purchase(`b=${BIZ}&value=10&currency=NAIRA`)).toEqual({ error: "invalid currency" });
    expect(purchase(`b=${BIZ}&value=10&currency=N1`)).toEqual({ error: "invalid currency" });
  });

  it("refuses a value too large to be a number we can trust", () => {
    expect(purchase(`b=${BIZ}&value=1e308`)).toEqual({ error: "invalid value" });
    expect(purchase(`b=${BIZ}&value=Infinity`)).toEqual({ error: "invalid value" });
    expect(purchase(`b=${BIZ}&value=-5`)).toEqual({ error: "invalid value" });
  });

  it("caps the order reference, since it becomes part of a unique key", () => {
    const r = purchase(`b=${BIZ}&value=10&order=${"x".repeat(500)}`);
    expect("orderRef" in r && r.orderRef?.length).toBe(120);
  });

  it("sets a ceiling no real thank-you page reaches", () => {
    expect(MAX_BEACON_SALE_USD_MINOR).toBe(10_000_000);
  });
});
