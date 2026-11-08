/**
 * Turning a production exception into something a person can act on.
 *
 * WHAT WAS MISSING. `log.ts` writes structured JSON to stdout, which Vercel
 * keeps briefly and nobody reads at 2am. There is no alerting, no grouping and
 * no history, so the honest description of the situation was: when something
 * breaks in production, the first you hear of it is a customer telling you.
 *
 * GROUPING IS THE WHOLE IDEA. A raw stream of exceptions is not monitoring --
 * one bad deploy produces ten thousand lines of the same thing and buries the
 * single rare error that actually matters. Collapsing repeats into one row
 * with a count turns "something is wrong" into "this is wrong, 412 times,
 * since Tuesday, on this route".
 *
 * So the fingerprint has to survive the parts of a message that change every
 * time. "business 9f3c-… not found" and "business 1a2b-… not found" are one
 * problem, not two, and anything that fingerprints them apart is useless on
 * exactly the day it is needed.
 */

/**
 * Replace the parts of a message that differ between occurrences of the same
 * fault: ids, numbers, quoted values, URLs, hex blobs.
 *
 * Deliberately aggressive. Over-grouping shows one row where there were two
 * problems, and the detail is still on the row; under-grouping shows ten
 * thousand rows and hides everything. The first is recoverable by reading, the
 * second is not recoverable at all.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/https?:\/\/[^\s"')]+/gi, "<url>")
    .replace(/"[^"]{0,200}"/g, '"<v>"')
    .replace(/'[^']{0,200}'/g, "'<v>'")
    // No word boundary: "timeout after 15000ms" has none between the digits
    // and the unit, so a bounded pattern leaves the number in and two
    // identical timeouts fingerprint apart.
    .replace(/\d[\d,._]*/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Secrets reach error messages constantly -- an upstream echoing back a URL
 * with a token in it, a driver quoting the connection string it failed on.
 * An error log is read by whoever is on call and pasted into chats, so the
 * careless version has to be safe. Mirrors log.ts's redaction, applied to
 * free text rather than object keys.
 */
export function redactMessage(message: string): string {
  return message
    .replace(/(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, "<redacted-key>")
    .replace(/\b(bearer|token|apikey|api_key|secret|password)\b\s*[:=]?\s*\S+/gi, "$1 <redacted>")
    .replace(/[?&](access_token|token|key|signature|secret)=[^&\s]+/gi, "$1=<redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<redacted-jwt>");
}

export interface ErrorFacts {
  message: string;
  route: string | null;
  routeType: string | null;
}

/**
 * A stable id for "this kind of error, here".
 *
 * Route is part of it on purpose: the same failure in the nightly job and in
 * a page render are different problems with different urgency, and merging
 * them would hide which one is new.
 */
export function fingerprint(facts: ErrorFacts): string {
  const basis = [normaliseMessage(facts.message), facts.route ?? "", facts.routeType ?? ""].join(
    "|",
  );
  return fnv1a128(basis);
}

/**
 * A grouping key, NOT a security primitive, and the distinction decides the
 * implementation.
 *
 * This started as sha256 from `node:crypto`, which broke the build: this
 * module is reached from `instrumentation.ts`, which Next loads in the Edge
 * runtime as well as Node, and `node:crypto` does not exist there. An error
 * thrown in the proxy -- edge code -- would have failed inside the error
 * reporter itself.
 *
 * Nothing here needs to resist an attacker. It needs two identical faults to
 * land on the same key and two different ones not to, over a few thousand
 * short strings. FNV-1a, run twice with different offsets for 128 bits, is
 * ample for that and runs anywhere.
 */
function fnv1a128(input: string): string {
  const hash = (offset: number): string => {
    let h = offset >>> 0;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      // The FNV prime, via shifts: a plain multiply overflows 32-bit maths.
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  // Four independent passes, so the key is 32 hex characters as before and a
  // chance collision needs four simultaneous ones.
  return [hash(0x811c9dc5), hash(0x01000193), hash(0xdeadbeef), hash(0x9e3779b9)].join("");
}

/** A stack trimmed to the frames that are ours, which is where the bug is. */
export function trimStack(stack: string | undefined, maxLines = 12): string | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  const ours = lines.filter((l) => !/node_modules|node:internal/.test(l));
  return redactMessage((ours.length > 1 ? ours : lines).slice(0, maxLines).join("\n")).slice(
    0,
    4_000,
  );
}

/** Everything the sink needs, derived from whatever Next handed us. */
export function describeError(
  err: unknown,
  request?: { path?: string; method?: string },
  context?: { routePath?: string; routeType?: string },
): {
  message: string;
  digest: string | null;
  route: string | null;
  method: string | null;
  routeType: string | null;
  stack: string | null;
  fingerprint: string;
} {
  // `unknown`, because a thrown string or object is legal and does happen.
  const raw = err instanceof Error ? err.message : String(err);
  const message = redactMessage(raw).slice(0, 1_000);
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest).slice(0, 120)
      : null;
  // routePath is the pattern (/app/duel/page); path is the real URL, which
  // carries ids and query strings. The pattern groups; the path would not.
  const route = context?.routePath || request?.path || null;
  const routeType = context?.routeType ?? null;
  return {
    message,
    digest,
    route,
    method: request?.method ?? null,
    routeType,
    stack: trimStack(err instanceof Error ? err.stack : undefined),
    fingerprint: fingerprint({ message, route, routeType }),
  };
}
