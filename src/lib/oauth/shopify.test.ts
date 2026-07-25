import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  extractClickId,
  hmacMessage,
  normalizeShopDomain,
  SHOPIFY_SCOPES,
  verifyShopifyHmac,
  verifyWebhookHmac,
  type ShopifyOAuthConfig,
} from "./shopify";

const cfg: ShopifyOAuthConfig = {
  apiKey: "key123",
  apiSecret: "shh-secret",
  redirectUri: "https://glocal.app/api/oauth/shopify/callback",
};

describe("normalizeShopDomain", () => {
  it("adds the myshopify suffix to a bare handle", () => {
    expect(normalizeShopDomain("ada-fashion")).toBe("ada-fashion.myshopify.com");
  });
  it("keeps a full domain and lowercases / strips scheme + path", () => {
    expect(normalizeShopDomain("https://Ada-Fashion.myshopify.com/admin")).toBe(
      "ada-fashion.myshopify.com",
    );
  });
  it("rejects non-shopify domains and junk", () => {
    expect(() => normalizeShopDomain("evil.com")).toThrow();
    expect(() => normalizeShopDomain("")).toThrow();
    expect(() => normalizeShopDomain("ada.myshopify.evil.com")).toThrow();
  });
});

describe("buildAuthorizeUrl", () => {
  it("points at the shop's admin with our scope, redirect and state", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "ada.myshopify.com", "state-xyz"));
    expect(url.hostname).toBe("ada.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("key123");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("scope")).toBe(SHOPIFY_SCOPES.join(","));
  });
});

describe("hmacMessage + verifyShopifyHmac", () => {
  it("builds a sorted message excluding hmac and verifies a real signature", () => {
    const params = new URLSearchParams({
      code: "abc",
      shop: "ada.myshopify.com",
      state: "s1",
      timestamp: "123",
    });
    const msg = hmacMessage(params);
    expect(msg).toBe("code=abc&shop=ada.myshopify.com&state=s1&timestamp=123");
    const sig = createHmac("sha256", cfg.apiSecret).update(msg).digest("hex");
    params.set("hmac", sig);
    expect(verifyShopifyHmac(params, cfg.apiSecret)).toBe(true);
  });
  it("rejects a tampered payload or missing hmac", () => {
    const params = new URLSearchParams({ code: "abc", shop: "ada.myshopify.com" });
    const sig = createHmac("sha256", cfg.apiSecret).update(hmacMessage(params)).digest("hex");
    params.set("hmac", sig);
    params.set("code", "tampered");
    expect(verifyShopifyHmac(params, cfg.apiSecret)).toBe(false);
    expect(verifyShopifyHmac(new URLSearchParams({ code: "abc" }), cfg.apiSecret)).toBe(false);
  });
});

describe("verifyWebhookHmac", () => {
  it("verifies a base64 body signature and rejects tampering", () => {
    const body = JSON.stringify({ id: 1, total_price: "20.00" });
    const sig = createHmac("sha256", cfg.apiSecret).update(body, "utf8").digest("base64");
    expect(verifyWebhookHmac(body, sig, cfg.apiSecret)).toBe(true);
    expect(verifyWebhookHmac(body + "x", sig, cfg.apiSecret)).toBe(false);
    expect(verifyWebhookHmac(body, null, cfg.apiSecret)).toBe(false);
  });
});

describe("extractClickId", () => {
  it("prefers a gcid note attribute", () => {
    expect(
      extractClickId({ note_attributes: [{ name: "gcid", value: "cid-1" }], landing_site: "/x" }),
    ).toBe("cid-1");
  });
  it("falls back to the landing_site query", () => {
    expect(extractClickId({ landing_site: "https://shop.com/?utm=x&gcid=cid-2&a=1" })).toBe("cid-2");
  });
  it("returns null when absent", () => {
    expect(extractClickId({ landing_site: "https://shop.com/" })).toBeNull();
    expect(extractClickId({})).toBeNull();
  });
});
