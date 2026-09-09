/**
 * How long a signed-in session may sit idle before it is ended.
 *
 * WHY THIS IS NOT ONE SHORT NUMBER FOR EVERYONE.
 *
 * Shared devices are ordinary here — a laptop on a shop counter, a cybercafé
 * machine — and a live session can spend the ad wallet. That argues for a short
 * timeout. But sign-in is a one-time code sent by email, with no password, so
 * every timeout costs a trip to the inbox. A twenty-minute idle limit applied
 * to everybody would sign a shopkeeper out while they served a customer,
 * several times a day.
 *
 * So the person signing in says which situation they are in, and only the
 * shared case pays the short timeout. The default is deliberately the generous
 * one: someone who does not read the checkbox is on their own phone far more
 * often than not, and the cost of guessing wrong in that direction is an
 * attacker needing physical access to an unlocked personal device.
 *
 * Worth being precise about what a stolen session actually reaches, because it
 * is what justifies not being more aggressive: NOT the money. Withdrawals
 * refund to the card that paid in, so someone else's session can only send
 * funds back to a card that is not theirs. The exposure is ad spend and
 * business data — worth defending, not worth locking people out hourly for.
 */

export const SESSION_POLICIES = ["private", "shared"] as const;
export type SessionPolicy = (typeof SESSION_POLICIES)[number];

/** Cookie holding the chosen policy. Not security-critical: it can only ever shorten or lengthen the caller's OWN session. */
export const POLICY_COOKIE = "glocal-session-policy";
/** Cookie holding the last time this session was seen, as epoch milliseconds. */
export const LAST_SEEN_COOKIE = "glocal-last-seen";
/** Cookie holding when this session began, for the absolute ceiling below. */
export const SESSION_START_COOKIE = "glocal-session-start";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const IDLE_LIMIT_MS: Record<SessionPolicy, number> = {
  // A personal phone or laptop. Long enough to survive a working day of
  // dipping in and out, short enough that a lost phone is not a standing key.
  private: 12 * HOUR,
  // A shared or public machine. Twenty minutes, the number a counter-top
  // browser deserves.
  shared: 20 * MINUTE,
};

/**
 * An absolute ceiling regardless of activity. Refresh tokens otherwise renew
 * indefinitely, so without this a session that is used every day never ends at
 * all — which is how a machine nobody remembers signing in on keeps working a
 * year later.
 */
export const ABSOLUTE_LIMIT_MS = 30 * 24 * HOUR;

export function isSessionPolicy(value: unknown): value is SessionPolicy {
  return typeof value === "string" && (SESSION_POLICIES as readonly string[]).includes(value);
}

/** An unreadable or absent cookie means the generous default, never an error. */
export function policyFrom(raw: string | undefined): SessionPolicy {
  return isSessionPolicy(raw) ? raw : "private";
}

export type SessionVerdict =
  | { action: "continue" }
  | { action: "expire"; reason: "idle" | "absolute" };

/**
 * Decide whether a request may proceed.
 *
 * Pure, so the awkward cases are testable without a browser: a missing cookie,
 * a cookie someone has hand-edited to a non-number, and a clock that has moved
 * backwards (a device correcting its time, or a user setting it) all have to
 * resolve to something sensible rather than throwing or expiring instantly.
 */
export function evaluateSession(input: {
  now: number;
  lastSeen: string | undefined;
  startedAt: string | undefined;
  policy: SessionPolicy;
}): SessionVerdict {
  const { now, policy } = input;

  const startedAt = Number(input.startedAt);
  if (Number.isFinite(startedAt) && now - startedAt > ABSOLUTE_LIMIT_MS) {
    return { action: "expire", reason: "absolute" };
  }

  const lastSeen = Number(input.lastSeen);
  // No usable timestamp yet: this is the first request of a session, or the
  // cookie was cleared. Let it through and stamp it — expiring here would make
  // signing in impossible rather than making anything safer.
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return { action: "continue" };

  const idleFor = now - lastSeen;
  // A negative gap means the clock moved backwards, not that the session is
  // fresh forever. Treat it as activity now rather than trusting the future
  // timestamp, which would otherwise hold the session open indefinitely.
  if (idleFor < 0) return { action: "continue" };

  return idleFor > IDLE_LIMIT_MS[policy]
    ? { action: "expire", reason: "idle" }
    : { action: "continue" };
}
