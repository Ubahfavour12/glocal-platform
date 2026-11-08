import { afterEach, describe, expect, it } from "vitest";
import { STEP_SECONDS, base32Decode, totp, totpConfigured, verifyTotp } from "./totp";

// RFC 6238 publishes test vectors for the ASCII secret "12345678901234567890".
// Base32 of those twenty bytes:
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

afterEach(() => {
  delete process.env.ADMIN_TOTP_SECRET;
});

describe("base32Decode", () => {
  it("decodes what an authenticator app would show", () => {
    // RFC 4648 vector: BASE32("foo") = "MZXW6===".
    expect(base32Decode("MZXW6===").toString()).toBe("foo");
    expect(base32Decode("MZXW6YQ=").toString()).toBe("foob");
  });

  it("ignores spacing and case, which is how people paste secrets", () => {
    expect(base32Decode("mzxw 6===").toString()).toBe("foo");
  });

  it("rejects rubbish rather than decoding it to something", () => {
    expect(() => base32Decode("not-base32!")).toThrow();
    expect(() => base32Decode("")).toThrow();
  });
});

describe("totp", () => {
  it("matches the RFC 6238 vector", () => {
    // t=59s is the first published vector; SHA-1, 8 digits, 94287082.
    // Truncated to our 6 digits that is the last six.
    expect(totp(RFC_SECRET, 59_000)).toBe("287082");
  });

  it("matches a later RFC vector", () => {
    // t=1111111109 -> 07081804
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
  });

  it("changes every step and is stable within one", () => {
    const base = 1_700_000_000_000;
    expect(totp(RFC_SECRET, base)).toBe(totp(RFC_SECRET, base + 1_000));
    expect(totp(RFC_SECRET, base)).not.toBe(
      totp(RFC_SECRET, base + STEP_SECONDS * 1_000),
    );
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;

  it("accepts the current code", () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(true);
  });

  it("tolerates a phone clock one step out, either way", () => {
    // Zero tolerance rejects honest people: clocks drift, and a code typed at
    // the end of its window arrives in the next one.
    const prev = totp(RFC_SECRET, now - STEP_SECONDS * 1_000);
    const next = totp(RFC_SECRET, now + STEP_SECONDS * 1_000);
    expect(verifyTotp(RFC_SECRET, prev, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, next, now)).toBe(true);
  });

  it("refuses a code two steps out", () => {
    const stale = totp(RFC_SECRET, now - STEP_SECONDS * 2_000);
    expect(verifyTotp(RFC_SECRET, stale, now)).toBe(false);
  });

  it("refuses anything that is not six digits", () => {
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "1234567", now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "", now)).toBe(false);
  });

  it("FAILS CLOSED on a malformed secret", () => {
    // A configuration slip must lock the door, not open it. This is the
    // single most important assertion in the file.
    expect(verifyTotp("not-base32!", "000000", now)).toBe(false);
    expect(verifyTotp("", totp(RFC_SECRET, now), now)).toBe(false);
  });

  it("tolerates spaces, because authenticator apps display them", () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });
});

describe("totpConfigured", () => {
  it("is false when unset, so the gate can refuse rather than wave people past", () => {
    expect(totpConfigured()).toBe(false);
  });

  it("is false for a secret that cannot be decoded", () => {
    process.env.ADMIN_TOTP_SECRET = "not-base32!";
    expect(totpConfigured()).toBe(false);
  });

  it("is false for a secret too short to be real", () => {
    process.env.ADMIN_TOTP_SECRET = "MZXW6";
    expect(totpConfigured()).toBe(false);
  });

  it("is true for a proper secret", () => {
    process.env.ADMIN_TOTP_SECRET = RFC_SECRET;
    expect(totpConfigured()).toBe(true);
  });
});
