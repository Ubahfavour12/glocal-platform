import { afterEach, describe, expect, it, vi } from "vitest";
import { log, redact, requestId } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("redact — the reason this module exists", () => {
  it("strips anything that looks like a credential", () => {
    expect(
      redact({ authorization: "Bearer sk_live_x", apiKey: "abc", signature: "sig" }),
    ).toEqual({ authorization: "[redacted]", apiKey: "[redacted]", signature: "[redacted]" });
  });

  it("strips personal contact details too", () => {
    // Not a secret, but it is the customer's, and logs travel.
    expect(redact({ email: "a@b.com", phone: "+234..." })).toEqual({
      email: "[redacted]",
      phone: "[redacted]",
    });
  });

  it("catches sensitive keys nested inside an object someone logged wholesale", () => {
    // The realistic failure: logging a whole request "just for now".
    expect(redact({ req: { headers: { Cookie: "session=1" }, body: { ok: true } } })).toEqual({
      req: { headers: { Cookie: "[redacted]" }, body: { ok: true } },
    });
  });

  it("keeps ordinary fields intact", () => {
    expect(redact({ businessId: "b1", amountUsdMinor: 7000 })).toEqual({
      businessId: "b1",
      amountUsdMinor: 7000,
    });
  });

  it("reduces an Error to name and message, not a whole stack", () => {
    expect(redact(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
  });

  it("survives a circular object instead of crashing the process", () => {
    // A logger that can take down what it is reporting on is worse than none.
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
  });

  it("truncates a very long string rather than logging a whole document", () => {
    const out = redact("x".repeat(2000)) as string;
    expect(out.length).toBeLessThan(600);
    expect(out.endsWith("…")).toBe(true);
  });

  it("caps array length", () => {
    expect((redact(new Array(100).fill(1)) as unknown[]).length).toBe(20);
  });
});

describe("log", () => {
  it("emits one JSON line carrying level, event and time", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("wallet.topup", { businessId: "b1", usdMinor: 7000 });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "info", event: "wallet.topup", businessId: "b1" });
    expect(typeof parsed.at).toBe("string");
  });

  it("sends errors to console.error so they surface as errors upstream", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("checkout.failed", { businessId: "b1" });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("redacts on the way out, not at the call site", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("psp.call", { authorization: "Bearer sk_live_secret" });
    expect(spy.mock.calls[0][0]).not.toContain("sk_live_secret");
  });
});

describe("requestId", () => {
  it("prefers the platform's own id so our lines join theirs", () => {
    expect(requestId(new Headers({ "x-vercel-id": "iad1::abc" }))).toBe("iad1::abc");
  });

  it("invents one when there is none", () => {
    expect(requestId(new Headers())).toMatch(/^req_/);
  });
});
