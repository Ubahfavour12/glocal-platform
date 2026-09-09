import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_LIMIT_MS,
  IDLE_LIMIT_MS,
  evaluateSession,
  isSessionPolicy,
  policyFrom,
} from "./session-policy";

const NOW = 1_800_000_000_000;
const ok = (over: Partial<Parameters<typeof evaluateSession>[0]> = {}) =>
  evaluateSession({
    now: NOW,
    lastSeen: String(NOW - 1000),
    startedAt: String(NOW - 1000),
    policy: "private",
    ...over,
  });

describe("policyFrom", () => {
  it("defaults to the generous policy when the cookie is absent or junk", () => {
    // Someone who never saw the checkbox is on their own device far more often
    // than not, and a wrong guess here only costs an attacker-with-your-phone.
    expect(policyFrom(undefined)).toBe("private");
    expect(policyFrom("")).toBe("private");
    expect(policyFrom("SHARED; DROP TABLE")).toBe("private");
  });

  it("honours a real policy", () => {
    expect(policyFrom("shared")).toBe("shared");
    expect(policyFrom("private")).toBe("private");
  });

  it("guards the type", () => {
    expect(isSessionPolicy("shared")).toBe(true);
    expect(isSessionPolicy("forever")).toBe(false);
    expect(isSessionPolicy(null)).toBe(false);
  });
});

describe("idle expiry", () => {
  it("lets an active session through", () => {
    expect(ok().action).toBe("continue");
  });

  it("expires a shared device after 20 minutes", () => {
    const justUnder = ok({ policy: "shared", lastSeen: String(NOW - IDLE_LIMIT_MS.shared + 1) });
    const justOver = ok({ policy: "shared", lastSeen: String(NOW - IDLE_LIMIT_MS.shared - 1) });
    expect(justUnder.action).toBe("continue");
    expect(justOver).toEqual({ action: "expire", reason: "idle" });
  });

  it("does NOT expire a personal device at 20 minutes", () => {
    // The whole point of splitting the policies: a shopkeeper serving a
    // customer for half an hour must not have to fetch a code from email.
    const after30min = ok({ policy: "private", lastSeen: String(NOW - 30 * 60_000) });
    expect(after30min.action).toBe("continue");
  });

  it("expires a personal device after 12 hours", () => {
    expect(ok({ policy: "private", lastSeen: String(NOW - IDLE_LIMIT_MS.private - 1) })).toEqual({
      action: "expire",
      reason: "idle",
    });
  });
});

describe("absolute ceiling", () => {
  it("ends a session 30 days old however active it has been", () => {
    expect(
      ok({ lastSeen: String(NOW - 1000), startedAt: String(NOW - ABSOLUTE_LIMIT_MS - 1) }),
    ).toEqual({ action: "expire", reason: "absolute" });
  });

  it("outranks the idle check, so the reason reported is the real one", () => {
    expect(
      ok({
        policy: "shared",
        lastSeen: String(NOW - IDLE_LIMIT_MS.shared - 1),
        startedAt: String(NOW - ABSOLUTE_LIMIT_MS - 1),
      }),
    ).toEqual({ action: "expire", reason: "absolute" });
  });
});

describe("cookies that cannot be trusted", () => {
  it("lets a first request through rather than expiring it", () => {
    // Expiring on a missing stamp would make signing in impossible: the very
    // first request after sign-in has no last-seen cookie yet.
    expect(ok({ lastSeen: undefined, startedAt: undefined }).action).toBe("continue");
  });

  it("treats a hand-edited non-numeric stamp as a first request", () => {
    expect(ok({ lastSeen: "tomorrow" }).action).toBe("continue");
    expect(ok({ lastSeen: "0" }).action).toBe("continue");
  });

  it("does not hold a session open forever on a future timestamp", () => {
    // A clock that jumped backwards, or a user setting one. Continue, but the
    // caller re-stamps to now, so the next request is measured honestly.
    expect(ok({ lastSeen: String(NOW + 10 * 60_000) }).action).toBe("continue");
  });

  it("ignores an unparseable start time rather than expiring on it", () => {
    expect(ok({ startedAt: "never" }).action).toBe("continue");
  });
});
