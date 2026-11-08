import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Where the founder console's secrets live.
 *
 * The database first, the environment as a fallback. That order is the whole
 * change: the seed used to exist only in ADMIN_TOTP_SECRET, so enrolling
 * meant having a terminal, the repository and a trusted machine — and the
 * first time it was actually needed, none of those were to hand. A control
 * that can only be set up from one laptop is a locked door with the key in
 * another city.
 *
 * The environment still wins nothing and loses nothing: if someone has
 * already set the variables, they keep working. Nobody has to migrate.
 */

export interface OpsCredentials {
  totpSecret: string;
  sessionSecret: string;
  /** Where these came from, which the enrolment page needs to know. */
  source: "database" | "environment";
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 20 random bytes as base32 — the shape authenticator apps expect. */
export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function generateSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** The otpauth:// URI an authenticator app scans or imports. */
export function otpauthUri(secret: string, account: string): string {
  const issuer = "Glocal";
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  );
}

/** Grouped in fours, because people type these off a screen. */
export function formatSecretForTyping(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}

/**
 * The credentials in force, or null when the console has never been enrolled.
 *
 * Never throws: a database that cannot be reached means "no credentials",
 * which the gate turns into a refusal. Failing closed here is the only safe
 * direction — the alternative is an outage quietly becoming an open door.
 */
export async function loadOpsCredentials(): Promise<OpsCredentials | null> {
  const envTotp = process.env.ADMIN_TOTP_SECRET?.trim();
  const envSession = process.env.ADMIN_SESSION_SECRET?.trim();

  try {
    const { data } = await createServiceClient()
      .from("ops_credentials")
      .select("totp_secret, session_secret")
      .maybeSingle();
    if (data?.totp_secret && data?.session_secret) {
      return {
        totpSecret: String(data.totp_secret),
        sessionSecret: String(data.session_secret),
        source: "database",
      };
    }
  } catch {
    // Fall through to the environment rather than locking out someone who
    // configured it the old way and whose database is briefly unreachable.
  }

  if (envTotp && envSession) {
    return { totpSecret: envTotp, sessionSecret: envSession, source: "environment" };
  }
  return null;
}

/** How long a candidate key stays the one on offer. Mirrors the migration. */
export const ENROLMENT_WINDOW_MINUTES = 30;

/**
 * The candidate key for an enrolment in progress, created on first ask.
 *
 * WHY THIS IS NOT JUST `generateTotpSecret()`. It used to be, in the page
 * body, with `force-dynamic` above it -- so every render minted a new key
 * while the phone still held the previous one, and the only sequence anyone
 * actually performs (read key, leave for the authenticator app, come back,
 * type code) broke the moment coming back re-fetched the page. Mobile
 * browsers do that routinely. The code was right; the key it was checked
 * against had been replaced behind it.
 *
 * So a fresh pair is generated on every call and OFFERED, and the database
 * hands back whichever pair is actually in flight. Re-render as often as you
 * like: for half an hour the key on screen does not move.
 *
 * Returns null only if the database refuses, which the page turns into "try
 * again" rather than showing a key that cannot be verified later.
 */
export async function beginEnrolment(
  startedBy: string,
): Promise<{ totpSecret: string; sessionSecret: string } | null> {
  try {
    const { data, error } = await createServiceClient()
      .rpc("begin_ops_enrolment", {
        p_totp_secret: generateTotpSecret(),
        p_session_secret: generateSessionSecret(),
        p_started_by: startedBy,
        p_ttl_minutes: ENROLMENT_WINDOW_MINUTES,
      })
      .maybeSingle<{ totp_secret: string; session_secret: string }>();
    if (error || !data?.totp_secret || !data?.session_secret) return null;
    return { totpSecret: data.totp_secret, sessionSecret: data.session_secret };
  } catch {
    return null;
  }
}

/**
 * The candidate currently in flight, read server-side at verification time.
 *
 * The secret used to travel in the form and come back with the code, which
 * was defensible but had one fatal consequence: a page that had re-rendered
 * submitted a DIFFERENT secret from the one in the phone, and the mismatch
 * was indistinguishable from a wrong code. Reading it here instead means the
 * browser sends only six digits, and there is exactly one key those digits
 * can be checked against.
 */
export async function pendingEnrolment(): Promise<{
  totpSecret: string;
  sessionSecret: string;
} | null> {
  try {
    const { data } = await createServiceClient()
      .from("ops_pending_enrolment")
      .select("totp_secret, session_secret, started_at")
      .maybeSingle();
    if (!data?.totp_secret || !data?.session_secret) return null;
    // Expiry is enforced here as well as in the function, so a candidate
    // cannot be promoted days later just because nobody asked for a new one.
    const startedMs = Date.parse(String(data.started_at));
    if (Number.isFinite(startedMs)) {
      const ageMinutes = (Date.now() - startedMs) / 60_000;
      if (ageMinutes > ENROLMENT_WINDOW_MINUTES) return null;
    }
    return {
      totpSecret: String(data.totp_secret),
      sessionSecret: String(data.session_secret),
    };
  } catch {
    return null;
  }
}

/** Drop the candidate once it has been promoted, or abandoned. */
export async function clearPendingEnrolment(): Promise<void> {
  try {
    await createServiceClient().from("ops_pending_enrolment").delete().eq("id", true);
  } catch {
    /* A stale candidate expires on its own; never worth failing enrolment. */
  }
}

/**
 * Store a freshly enrolled pair.
 *
 * Refuses if a credential already exists. Enrolment is first-run only: once
 * the console has a second factor, replacing it must not be something a
 * single compromised email can do, and re-enrolment goes through a deliberate
 * reset rather than through this page.
 */
export async function enrolOpsCredentials(
  totpSecret: string,
  sessionSecret: string,
  enrolledBy: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const svc = createServiceClient();
    const { data: existing } = await svc
      .from("ops_credentials")
      .select("id")
      .maybeSingle();
    if (existing) return { ok: false, reason: "already enrolled" };

    const { error } = await svc.from("ops_credentials").insert({
      id: true,
      totp_secret: totpSecret,
      session_secret: sessionSecret,
      enrolled_by: enrolledBy,
    });
    if (error) return { ok: false, reason: error.message };
    // Promoted, so the candidate has done its job. Left behind it would be an
    // unconfirmed secret sitting in the database for no reason at all.
    await clearPendingEnrolment();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Has the console ever been enrolled, by either route? */
export async function opsEnrolled(): Promise<boolean> {
  return (await loadOpsCredentials()) !== null;
}
