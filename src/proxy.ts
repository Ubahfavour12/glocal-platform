import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  LAST_SEEN_COOKIE,
  POLICY_COOKIE,
  SESSION_START_COOKIE,
  evaluateSession,
  policyFrom,
} from "@/lib/auth/session-policy";

/**
 * Refreshes the Supabase session cookie on every request (UF-1 auth), and ends
 * sessions that have gone idle.
 *
 * Renamed from `middleware.ts`: Next 16 deprecated that convention in favour of
 * `proxy`, on the grounds that "middleware" invites Express-shaped assumptions
 * about a thing that actually runs at the network edge.
 *
 * No-ops gracefully while Supabase isn't configured yet, so the app keeps
 * working in demo mode during early development.
 *
 * The idle check lives here rather than in a layout because it has to cover
 * every route including API calls, and because it must be able to clear cookies
 * on the response — a Server Component cannot.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  // Nothing to time out when nobody is signed in, and stamping an anonymous
  // visitor would start their clock before they ever sign in.
  if (!data.user) return response;

  const policy = policyFrom(request.cookies.get(POLICY_COOKIE)?.value);
  const now = Date.now();
  const verdict = evaluateSession({
    now,
    lastSeen: request.cookies.get(LAST_SEEN_COOKIE)?.value,
    startedAt: request.cookies.get(SESSION_START_COOKIE)?.value,
    policy,
  });

  if (verdict.action === "expire") {
    await supabase.auth.signOut();
    const signedOut = NextResponse.redirect(
      new URL(`/login?timeout=${verdict.reason}`, request.url),
    );
    // Copy the sign-out cookie clears onto the redirect: they were written to
    // `response`, which we are now discarding, and without them the browser
    // keeps a session the server has already ended.
    response.cookies.getAll().forEach((c) => signedOut.cookies.set(c));
    [LAST_SEEN_COOKIE, SESSION_START_COOKIE, POLICY_COOKIE].forEach((name) =>
      signedOut.cookies.delete(name),
    );
    return signedOut;
  }

  // Sliding window: every request the user actually makes pushes the deadline
  // out. httpOnly so page scripts cannot extend a session they should not.
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  response.cookies.set(LAST_SEEN_COOKIE, String(now), cookieOptions);
  if (!request.cookies.get(SESSION_START_COOKIE)) {
    response.cookies.set(SESSION_START_COOKIE, String(now), cookieOptions);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|l/).*)"],
};
