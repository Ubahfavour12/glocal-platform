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
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Has the console ever been enrolled, by either route? */
export async function opsEnrolled(): Promise<boolean> {
  return (await loadOpsCredentials()) !== null;
}
