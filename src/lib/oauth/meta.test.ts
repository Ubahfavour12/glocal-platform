import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  META_SCOPES,
  parsePages,
  parseTokenResponse,
  tokenExpiry,
  type MetaOAuthConfig,
} from "./meta";

const cfg: MetaOAuthConfig = {
  appId: "app123",
  appSecret: "secret",
  redirectUri: "https://glocal.app/api/oauth/meta/callback",
};

describe("buildAuthorizeUrl", () => {
  it("points at Meta's dialog with our scopes, redirect and state", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "state-xyz"));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("client_id")).toBe("app123");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("response_type")).toBe("code");
    for (const scope of ["pages_manage_posts", "instagram_content_publish"]) {
      expect(url.searchParams.get("scope")).toContain(scope);
    }
    expect(META_SCOPES).toContain("pages_show_list");
  });
});

describe("parseTokenResponse", () => {
  it("reads a token and its lifetime", () => {
    expect(parseTokenResponse({ access_token: "tok", expires_in: 5184000 })).toEqual({
      accessToken: "tok",
      expiresInSeconds: 5184000,
    });
  });
  it("tolerates a missing expiry (never-expiring page token)", () => {
    expect(parseTokenResponse({ access_token: "tok" }).expiresInSeconds).toBeNull();
  });
  it("throws on an error payload or missing token", () => {
    expect(() => parseTokenResponse({ error: { message: "bad code" } })).toThrow(/bad code/);
    expect(() => parseTokenResponse({})).toThrow(/no access_token/);
  });
});

describe("parsePages", () => {
  it("flattens pages and links the Instagram business account", () => {
    const pages = parsePages({
      data: [
        {
          id: "p1",
          name: "Ada's Fashion",
          access_token: "pt1",
          instagram_business_account: { id: "ig1" },
        },
        { id: "p2", name: "No IG", access_token: "pt2" },
        { id: "p3", name: "no token dropped" }, // no access_token -> excluded
      ],
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({
      pageId: "p1",
      name: "Ada's Fashion",
      pageAccessToken: "pt1",
      instagramId: "ig1",
    });
    expect(pages[1].instagramId).toBeNull();
  });
  it("handles an empty account list", () => {
    expect(parsePages({})).toEqual([]);
  });
});

describe("tokenExpiry", () => {
  const now = new Date("2026-07-24T00:00:00Z");
  it("adds the lifetime to now", () => {
    expect(tokenExpiry(3600, now)).toEqual(new Date("2026-07-24T01:00:00Z"));
  });
  it("null lifetime -> no expiry", () => {
    expect(tokenExpiry(null, now)).toBeNull();
    expect(tokenExpiry(0, now)).toBeNull();
  });
});
