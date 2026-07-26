import { describe, expect, it } from "vitest";
import {
  buildInstagramAuthorizeUrl,
  INSTAGRAM_SCOPES,
  parseLongToken,
  parseShortToken,
  tokenExpiry,
  type InstagramOAuthConfig,
} from "./instagram";

const cfg: InstagramOAuthConfig = {
  appId: "ig123",
  appSecret: "secret",
  redirectUri: "https://glocal.app/api/oauth/instagram/callback",
};

describe("buildInstagramAuthorizeUrl", () => {
  it("points at instagram.com (not facebook.com) with our scopes and state", () => {
    const url = new URL(buildInstagramAuthorizeUrl(cfg, "state-xyz"));
    expect(url.hostname).toBe("www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("ig123");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_SCOPES.join(","));
    expect(INSTAGRAM_SCOPES).toContain("instagram_business_content_publish");
  });
});

describe("parseShortToken", () => {
  it("reads the token and stringifies the user id", () => {
    expect(parseShortToken({ access_token: "tok", user_id: 178414 })).toEqual({
      accessToken: "tok",
      userId: "178414",
    });
  });
  it("throws on an error payload or missing token", () => {
    expect(() => parseShortToken({ error_message: "bad code" })).toThrow(/bad code/);
    expect(() => parseShortToken({})).toThrow(/no access_token/);
  });
});

describe("parseLongToken", () => {
  it("reads a long-lived token and its lifetime", () => {
    expect(parseLongToken({ access_token: "long", expires_in: 5184000 })).toEqual({
      accessToken: "long",
      expiresInSeconds: 5184000,
    });
  });
  it("throws on error or missing token", () => {
    expect(() => parseLongToken({ error: { message: "nope" } })).toThrow(/nope/);
    expect(() => parseLongToken({})).toThrow(/no long-lived/);
  });
});

describe("tokenExpiry", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  it("adds the lifetime to now", () => {
    expect(tokenExpiry(3600, now)).toEqual(new Date("2026-07-26T01:00:00Z"));
  });
  it("null/zero lifetime means no expiry", () => {
    expect(tokenExpiry(null, now)).toBeNull();
    expect(tokenExpiry(0, now)).toBeNull();
  });
});
