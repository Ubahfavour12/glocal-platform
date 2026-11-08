import { afterEach, describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_MS,
  adminSessionConfigured,
  issueAdminSession,
  readAdminSession,
} from "./session";

const EMAIL = "founder@example.com";
const NOW = 1_700_000_000_000;

afterEach(() => {
  delete process.env.ADMIN_SESSION_SECRET;
});

const withSecret = (secret = "a-long-server-side-secret") => {
  process.env.ADMIN_SESSION_SECRET = secret;
};

describe("issue and read", () => {
  it("round-trips the email", () => {
    withSecret();
    const cookie = issueAdminSession(EMAIL, NOW)!;
    expect(readAdminSession(cookie, NOW + 1_000)).toBe(EMAIL);
  });

  it("expires", () => {
    withSecret();
    const cookie = issueAdminSession(EMAIL, NOW)!;
    expect(readAdminSession(cookie, NOW + ADMIN_SESSION_MS - 1)).toBe(EMAIL);
    expect(readAdminSession(cookie, NOW + ADMIN_SESSION_MS + 1)).toBeNull();
  });
});

describe("forgery", () => {
  it("rejects a cookie signed with a different key", () => {
    withSecret("key-one");
    const cookie = issueAdminSession(EMAIL, NOW)!;
    withSecret("key-two");
    expect(readAdminSession(cookie, NOW)).toBeNull();
  });

  it("rejects a tampered email", () => {
    withSecret();
    const cookie = issueAdminSession(EMAIL, NOW)!;
    const [, expiry, sig] = cookie.split(".");
    const forged = `${Buffer.from("attacker@evil.test").toString("base64url")}.${expiry}.${sig}`;
    expect(readAdminSession(forged, NOW)).toBeNull();
  });

  it("rejects an extended expiry", () => {
    // The obvious attack: keep the signature, push the date out.
    withSecret();
    const cookie = issueAdminSession(EMAIL, NOW)!;
    const [email, , sig] = cookie.split(".");
    const forged = `${email}.${NOW + ADMIN_SESSION_MS * 100}.${sig}`;
    expect(readAdminSession(forged, NOW)).toBeNull();
  });

  it("rejects an unsigned or malformed cookie", () => {
    withSecret();
    expect(readAdminSession("garbage", NOW)).toBeNull();
    expect(readAdminSession("a.b", NOW)).toBeNull();
    expect(readAdminSession("", NOW)).toBeNull();
    expect(readAdminSession(undefined, NOW)).toBeNull();
  });
});

describe("when the server has no secret", () => {
  it("issues nothing and trusts nothing", () => {
    // Fails CLOSED. A missing secret must lock the door, never default to a
    // built-in one that anybody who has read the repository can forge with.
    expect(issueAdminSession(EMAIL, NOW)).toBeNull();
    expect(adminSessionConfigured()).toBe(false);
  });

  it("refuses a cookie that was valid under a configured secret", () => {
    withSecret();
    const cookie = issueAdminSession(EMAIL, NOW)!;
    delete process.env.ADMIN_SESSION_SECRET;
    expect(readAdminSession(cookie, NOW)).toBeNull();
  });
});
