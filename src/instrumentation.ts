import type { Instrumentation } from "next";

/**
 * Catch every server error and write it down somewhere a person will look.
 *
 * Next calls `onRequestError` for anything thrown in a Server Component, a
 * route handler, a server action or the proxy. Until now those went to stdout
 * and no further: Vercel keeps logs briefly, there is no alerting, and the
 * practical effect was that a production exception was invisible until a
 * customer reported it.
 *
 * THREE RULES, because an error reporter that misbehaves is worse than none.
 *
 * 1. IT MUST NOT THROW. Everything is inside a try, and the catch is empty on
 *    purpose. A reporter that fails while reporting turns one broken request
 *    into two, and the second has nowhere to be reported to.
 * 2. IT MUST NOT RECURSE. Writing to Supabase can itself fail; that failure is
 *    swallowed rather than reported, or a database outage becomes an infinite
 *    loop of errors about errors.
 * 3. IT MUST NOT BLOCK THE RESPONSE FOR LONG. Awaited, as Next requires, but
 *    against a short deadline -- the customer's request is already failing and
 *    making them wait for our bookkeeping helps nobody.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    // Imported lazily so nothing here is pulled into the Edge bundle or run
    // at boot, and so a missing service key cannot break the module graph.
    const [{ describeError }, { createServiceClient }, { log }] = await Promise.all([
      import("@/lib/observability/errors"),
      import("@/lib/supabase/server"),
      import("@/lib/log"),
    ]);

    const facts = describeError(err, request, context);

    // stdout first, and unconditionally. It is the one sink that works with
    // no configuration, no network and no database -- including when the
    // database is the thing that is broken.
    log.error("unhandled_server_error", {
      event: "unhandled_server_error",
      fingerprint: facts.fingerprint,
      route: facts.route ?? undefined,
      method: facts.method ?? undefined,
      routeType: facts.routeType ?? undefined,
      message: facts.message,
    });

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

    await Promise.race([
      createServiceClient().rpc("record_error_event", {
        p_fingerprint: facts.fingerprint,
        p_message: facts.message,
        p_digest: facts.digest,
        p_route: facts.route,
        p_method: facts.method,
        p_route_type: facts.routeType,
        p_stack: facts.stack,
      }),
      // The request is already failing; do not add seconds to it.
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  } catch {
    // Rule 1. There is deliberately nothing here.
  }
};
