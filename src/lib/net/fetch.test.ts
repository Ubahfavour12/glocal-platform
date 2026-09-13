import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMEOUT_MS, TimeoutError, fetchWithTimeout } from "./fetch";

afterEach(() => vi.unstubAllGlobals());

/** A fetch that never resolves until its signal aborts — a hung upstream. */
function stubHangingFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    ),
  );
}

describe("fetchWithTimeout", () => {
  it("gives up on an upstream that never answers", async () => {
    // The behaviour the whole module exists for: without this, the call hangs
    // until the serverless function is killed, billing the whole time.
    stubHangingFetch();
    await expect(fetchWithTimeout("https://slow.test/x", { timeoutMs: 20 })).rejects.toThrow(
      TimeoutError,
    );
  });

  it("names the host and the budget, never the full URL", async () => {
    // Query strings carry tokens and this message reaches logs.
    stubHangingFetch();
    await expect(
      fetchWithTimeout("https://api.test/v1/pay?secret=sk_live_abc", { timeoutMs: 20 }),
    ).rejects.toThrow(/^api\.test did not respond within 20ms$/);
  });

  it("passes a normal response straight through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 }) as Response));
    await expect(fetchWithTimeout("https://ok.test")).resolves.toMatchObject({ status: 200 });
  });

  it("forwards method, headers and body unchanged", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        calls.push(init);
        return { ok: true } as Response;
      }),
    );
    await fetchWithTimeout("https://ok.test", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });
    expect(calls[0]).toMatchObject({ method: "POST", body: "{}" });
    expect((calls[0].headers as Record<string, string>).Authorization).toBe("Bearer x");
  });

  it("reports a caller's own abort as an abort, not as our timeout", async () => {
    // Misreporting this would send someone hunting a slow upstream that was
    // actually a cancelled request.
    stubHangingFetch();
    const outer = new AbortController();
    const p = fetchWithTimeout("https://x.test", { signal: outer.signal, timeoutMs: 5_000 });
    outer.abort();
    await expect(p).rejects.toSatisfy((e: Error) => e.name === "AbortError");
  });

  it("fails immediately when handed an already-aborted signal", async () => {
    stubHangingFetch();
    const outer = new AbortController();
    outer.abort();
    await expect(
      fetchWithTimeout("https://x.test", { signal: outer.signal, timeoutMs: 5_000 }),
    ).rejects.toSatisfy((e: Error) => e.name === "AbortError");
  });

  it("lets a real network error through as itself", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(fetchWithTimeout("https://x.test")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("defaults to a sane budget", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
