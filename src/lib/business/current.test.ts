import { describe, expect, it, vi } from "vitest";

/**
 * The cookie is a hint, never an authority — these tests pin that.
 *
 * `cookies()` is mocked per test rather than globally so each case can state
 * its own starting point, which is the thing being varied.
 */
const cookieValue = { current: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_: string) =>
      cookieValue.current === undefined ? undefined : { value: cookieValue.current },
  }),
}));

const { currentBusiness, listBusinesses, BUSINESS_COOKIE } = await import("./current");

/**
 * A Supabase stand-in that records what it was asked.
 *
 * `byId` is what the caller's client returns for a cookie lookup — empty means
 * row-level security refused it, which is exactly what happens when the cookie
 * names somebody else's business.
 */
function client(opts: { byId?: Record<string, unknown> | null; oldest?: Record<string, unknown> | null }) {
  const calls: string[] = [];
  return {
    calls,
    from() {
      const q = {
        _eq: false,
        select() {
          return q;
        },
        eq(_col: string, val: string) {
          q._eq = true;
          calls.push(`eq:${val}`);
          return q;
        },
        order() {
          calls.push("order");
          return q;
        },
        limit() {
          return q;
        },
        async maybeSingle() {
          return { data: q._eq ? (opts.byId ?? null) : (opts.oldest ?? null) };
        },
      };
      return q;
    },
  } as never;
}

describe("currentBusiness", () => {
  it("falls back to the oldest when no cookie is set", () => {
    cookieValue.current = undefined;
    const c = client({ oldest: { id: "oldest" } });
    return currentBusiness(c).then((b) => {
      expect(b).toEqual({ id: "oldest" });
    });
  });

  it("honours a cookie naming a business the user owns", async () => {
    cookieValue.current = "chosen";
    const c = client({ byId: { id: "chosen" }, oldest: { id: "oldest" } });
    expect(await currentBusiness(c)).toEqual({ id: "chosen" });
  });

  it("FALLS BACK when the cookie names a business the user does not own", async () => {
    // RLS returns no row for someone else's business. The failure mode must be
    // "you see your own", never "you see a stranger's".
    cookieValue.current = "someone-elses";
    const c = client({ byId: null, oldest: { id: "mine" } });
    expect(await currentBusiness(c)).toEqual({ id: "mine" });
  });

  it("falls back on a stale cookie pointing at a deleted business", async () => {
    cookieValue.current = "deleted";
    const c = client({ byId: null, oldest: { id: "mine" } });
    expect(await currentBusiness(c)).toEqual({ id: "mine" });
  });

  it("returns null when the account has no business at all", async () => {
    // Pre-onboarding. Not an error.
    cookieValue.current = undefined;
    expect(await currentBusiness(client({ oldest: null }))).toBeNull();
  });

  it("looks the cookie up by id, so RLS is what decides", async () => {
    cookieValue.current = "b1";
    const c = client({ byId: { id: "b1" } });
    await currentBusiness(c);
    expect((c as unknown as { calls: string[] }).calls).toContain("eq:b1");
  });
});

describe("the cookie name", () => {
  it("is namespaced so it cannot collide with another app's cookie", () => {
    expect(BUSINESS_COOKIE).toContain("glocal");
  });
});

describe("listBusinesses", () => {
  it("returns an empty list rather than null when there are none", async () => {
    const c = {
      from: () => ({
        select: () => ({ order: async () => ({ data: null }) }),
      }),
    } as never;
    expect(await listBusinesses(c)).toEqual([]);
  });
});
