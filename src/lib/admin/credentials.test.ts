import { describe, expect, it } from "vitest";
import {
  formatSecretForTyping,
  generateSessionSecret,
  generateTotpSecret,
  otpauthUri,
} from "./credentials";
import { base32Decode, totp, verifyTotp } from "./totp";

describe("generateTotpSecret", () => {
  it("produces a secret an authenticator can actually use", () => {
    // The end-to-end property that matters: a generated secret must decode as
    // base32 and must verify against a code computed from it. A seed that
    // enrols and then rejects every code would lock the console permanently.
    const secret = generateTotpSecret();
    expect(base32Decode(secret).length).toBe(20);
    expect(verifyTotp(secret, totp(secret))).toBe(true);
  });

  it("is different every time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it("uses only the base32 alphabet, so it can be typed off a screen", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]+$/);
  });
});

describe("generateSessionSecret", () => {
  it("is long enough that the enrol route will accept it", () => {
    // The route refuses anything under 32 characters, because a signing key
    // with no entropy enrols fine and then protects nothing.
    expect(generateSessionSecret().length).toBeGreaterThanOrEqual(32);
  });

  it("is different every time", () => {
    expect(generateSessionSecret()).not.toBe(generateSessionSecret());
  });
});

describe("otpauthUri", () => {
  it("carries the secret and the standard parameters", () => {
    const secret = generateTotpSecret();
    const uri = otpauthUri(secret, "founder@example.com");
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("escapes an address that would otherwise break the path", () => {
    expect(otpauthUri("ABCD", "a+b@example.com")).toContain("a%2Bb%40example.com");
  });
});

describe("formatSecretForTyping", () => {
  it("groups in fours, because people read these off a screen", () => {
    expect(formatSecretForTyping("ABCDEFGH")).toBe("ABCD EFGH");
  });

  it("survives a length that is not a multiple of four", () => {
    expect(formatSecretForTyping("ABCDE")).toBe("ABCD E");
  });

  it("round-trips: the spaces it adds are ones base32Decode ignores", () => {
    // Otherwise the friendly display would produce a key that does not work.
    const secret = generateTotpSecret();
    expect(base32Decode(formatSecretForTyping(secret))).toEqual(base32Decode(secret));
  });
});
