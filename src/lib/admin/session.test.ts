import { describe, expect, it } from "vitest";
import { ADMIN_SESSION_MS, issueAdminSession, readAdminSession } from "./session";

const EMAIL = "founder@example.com";
const NOW = 1_700_000_000_000;
const KEY = "a-long-server-side-secret";

// The signing key is passed in now rather than read from the environment
// inside the module, so the console can be enrolled from a phone instead of
// needing a terminal and the repository.

describe("issue and read", () => {
  it("round-trips the email", () => {
    const cookie = issueAdminSession(EMAIL, KEY, NOW)!;
    expect(readAdminSession(cookie, KEY, NOW + 1_000)).toBe(EMAIL);
  });

  it("expires", () => {
    const cookie = issueAdminSession(EMAIL, KEY, NOW)!;
    expect(readAdminSession(cookie, KEY, NOW + ADMIN_SESSION_MS - 1)).toBe(EMAIL);
    expect(readAdminSession(cookie, KEY, NOW + ADMIN_SESSION_MS + 1)).toBeNull();
  });
});

describe("forgery", () => {
  it("rejects a cookie signed with a different key", () => {
    // Also the revocation story: rotating the secret signs every open
    // console out at once.
    const cookie = issueAdminSession(EMAIL, "key-one", NOW)!;
    expect(readAdminSession(cookie, "key-two", NOW)).toBeNull();
  });

  it("rejects a tampered email", () => {
    const cookie = issueAdminSession(EMAIL, KEY, NOW)!;
    const [, expiry, sig] = cookie.split(".");
    const forged = `${Buffer.from("attacker@evil.test").toString("base64url")}.${expiry}.${sig}`;
    expect(readAdminSession(forged, KEY, NOW)).toBeNull();
  });

  it("rejects an extended expiry", () => {
    // The obvious attack: keep the signature, push the date out.
    const cookie = issueAdminSession(EMAIL, KEY, NOW)!;
    const [email, , sig] = cookie.split(".");
    const forged = `${email}.${NOW + ADMIN_SESSION_MS * 100}.${sig}`;
    expect(readAdminSession(forged, KEY, NOW)).toBeNull();
  });

  it("rejects an unsigned or malformed cookie", () => {
    expect(readAdminSession("garbage", KEY, NOW)).toBeNull();
    expect(readAdminSession("a.b", KEY, NOW)).toBeNull();
    expect(readAdminSession("", KEY, NOW)).toBeNull();
    expect(readAdminSession(undefined, KEY, NOW)).toBeNull();
  });
});

describe("when there is no secret at all", () => {
  it("issues nothing and trusts nothing", () => {
    // Fails CLOSED. A missing secret must lock the door, never default to a
    // built-in one that anybody who has read the repository can forge with.
    expect(issueAdminSession(EMAIL, null, NOW)).toBeNull();
    expect(issueAdminSession(EMAIL, "   ", NOW)).toBeNull();
  });

  it("refuses a previously valid cookie once the secret is gone", () => {
    const cookie = issueAdminSession(EMAIL, KEY, NOW)!;
    expect(readAdminSession(cookie, null, NOW)).toBeNull();
  });
});
