import { describe, expect, it } from "vitest";
import { founderAllowlist, isFounder } from "./access";

describe("founder allowlist", () => {
  it("parses a pasted env var forgivingly", () => {
    const list = founderAllowlist(" Founder@Example.com , second@example.com ,, ");
    expect(list.has("founder@example.com")).toBe(true);
    expect(list.has("second@example.com")).toBe(true);
    expect(list.size).toBe(2);
  });

  it("is empty for an unset or blank variable", () => {
    expect(founderAllowlist(undefined).size).toBe(0);
    expect(founderAllowlist("").size).toBe(0);
    expect(founderAllowlist("  , ,  ").size).toBe(0);
  });
});

describe("isFounder — the gate in front of every customer's data", () => {
  const list = founderAllowlist("founder@example.com");

  it("lets the founder in", () => {
    expect(isFounder("founder@example.com", list)).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(isFounder("  Founder@Example.COM ", list)).toBe(true);
  });

  it("DENIES EVERYONE when the allowlist is unset", () => {
    // The failure that matters. Defaulting open on a missing env var would mean
    // one forgotten variable exposes every customer's wallet and spend to
    // anyone who can register an account.
    const unset = founderAllowlist(undefined);
    expect(isFounder("founder@example.com", unset)).toBe(false);
    expect(isFounder("anyone@example.com", unset)).toBe(false);
  });

  it("refuses an address that is not listed", () => {
    expect(isFounder("someone@example.com", list)).toBe(false);
  });

  it("refuses a missing or empty email", () => {
    expect(isFounder(null, list)).toBe(false);
    expect(isFounder(undefined, list)).toBe(false);
    expect(isFounder("   ", list)).toBe(false);
  });

  it("does not match on domain or substring", () => {
    // An allowlist, not a pattern.
    expect(isFounder("evil@example.com", list)).toBe(false);
    expect(isFounder("notfounder@example.com", list)).toBe(false);
    expect(isFounder("founder@example.com.attacker.net", list)).toBe(false);
  });
});
