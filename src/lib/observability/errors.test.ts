import { describe, expect, it } from "vitest";
import {
  describeError,
  fingerprint,
  normaliseMessage,
  redactMessage,
  trimStack,
} from "./errors";

describe("normaliseMessage", () => {
  it("collapses the parts that differ between occurrences of one fault", () => {
    // THE POINT OF THE WHOLE FILE. These are one problem, and anything that
    // fingerprints them apart produces ten thousand rows on the day you most
    // need one.
    const a = "business 9f3c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8 not found";
    const b = "business 11112222-3333-4444-5555-666677778888 not found";
    expect(normaliseMessage(a)).toBe(normaliseMessage(b));
  });

  it("collapses numbers, urls and quoted values", () => {
    expect(normaliseMessage("timeout after 15000ms")).toBe(
      normaliseMessage("timeout after 30000ms"),
    );
    expect(normaliseMessage('fetch https://a.test/x failed')).toBe(
      normaliseMessage('fetch https://b.test/y failed'),
    );
    expect(normaliseMessage('column "foo" missing')).toBe(
      normaliseMessage('column "bar" missing'),
    );
  });

  it("keeps genuinely different faults apart", () => {
    expect(normaliseMessage("wallet is empty")).not.toBe(
      normaliseMessage("ad account is quarantined"),
    );
  });
});

describe("redactMessage", () => {
  it("strips secrets that upstreams echo back", () => {
    // An error log is read by whoever is on call and pasted into chats. The
    // careless version has to be safe.
    expect(redactMessage("bad key sk_live_abc123XYZ")).not.toContain("sk_live_abc123XYZ");
    expect(redactMessage("GET /x?access_token=abc123 failed")).not.toContain("abc123");
    expect(redactMessage("Authorization: Bearer shhhh")).not.toContain("shhhh");
  });

  it("strips a JWT", () => {
    // Assembled rather than written out: a literal JWT in the repository trips
    // the secret scanner, which is correct of it -- the scanner cannot know
    // this one is a sample, and a scanner taught to ignore JWTs is no scanner.
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dBjftJeZ4CVPmB92K27uhb"].join(".");
    expect(redactMessage(`token ${jwt} rejected`)).not.toContain(jwt);
  });

  it("leaves an ordinary message alone", () => {
    expect(redactMessage("wallet is empty")).toBe("wallet is empty");
  });
});

describe("fingerprint", () => {
  it("separates the same message on different routes", () => {
    // Same failure in a nightly job and in a page render are different
    // problems with different urgency; merging them hides which one is new.
    const a = fingerprint({ message: "boom", route: "/api/jobs/nightly", routeType: "route" });
    const b = fingerprint({ message: "boom", route: "/duel", routeType: "render" });
    expect(a).not.toBe(b);
  });

  it("is stable across runs", () => {
    const facts = { message: "boom", route: "/x", routeType: "route" };
    expect(fingerprint(facts)).toBe(fingerprint(facts));
  });
});

describe("trimStack", () => {
  it("drops framework frames so what is left is ours", () => {
    const stack = [
      "Error: boom",
      "    at ourCode (/src/lib/thing.ts:12:3)",
      "    at next (/node_modules/next/dist/server/x.js:1:1)",
      "    at tick (node:internal/process/task_queues:1:1)",
    ].join("\n");
    const out = trimStack(stack)!;
    expect(out).toContain("ourCode");
    expect(out).not.toContain("node_modules");
  });

  it("keeps the original when every frame is framework", () => {
    // Better a framework stack than no stack.
    const stack = "Error: boom\n    at x (/node_modules/next/dist/a.js:1:1)";
    expect(trimStack(stack)).toContain("node_modules");
  });

  it("handles a missing stack", () => {
    expect(trimStack(undefined)).toBeNull();
  });
});

describe("describeError", () => {
  it("prefers the route PATTERN over the real path", () => {
    // The path carries ids and query strings, so it would fingerprint every
    // customer's failure as a separate problem.
    const d = describeError(
      new Error("boom"),
      { path: "/duel?business=9f3c1a2b", method: "GET" },
      { routePath: "/duel", routeType: "render" },
    );
    expect(d.route).toBe("/duel");
    expect(d.method).toBe("GET");
  });

  it("survives something that is not an Error", () => {
    // Throwing a string is legal and does happen.
    const d = describeError("just a string");
    expect(d.message).toBe("just a string");
    expect(d.stack).toBeNull();
    expect(d.fingerprint).toHaveLength(32);
  });

  it("picks up a React digest when there is one", () => {
    const err = Object.assign(new Error("boom"), { digest: "1234567890" });
    expect(describeError(err).digest).toBe("1234567890");
  });

  it("redacts before fingerprinting, so a secret never becomes a key", () => {
    const d = describeError(new Error("auth failed for sk_live_SECRET"));
    expect(d.message).not.toContain("sk_live_SECRET");
  });
});
