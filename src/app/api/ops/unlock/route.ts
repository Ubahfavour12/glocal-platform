import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, issueAdminSession } from "@/lib/admin/session";
import { verifyTotp } from "@/lib/admin/totp";
import { loadOpsCredentials } from "@/lib/admin/credentials";
import { checkRateLimit } from "@/lib/net/rate-limit";

/**
 * Second factor for the founder console.
 *
 * Every refusal returns the SAME message and the same status. A gate that
 * says "wrong code" to one caller and "not authorised" to another is telling
 * a stranger which half they got right, and the whole value of two factors is
 * that neither half is useful alone.
 *
 * Every attempt is written to the audit log, success or failure. If somebody
 * does come for this, the record of them trying is the only warning there
 * will be.
 */
const DENIED = NextResponse.json({ error: "that did not work" }, { status: 401 });

export async function POST(req: NextRequest) {
  const creds = await loadOpsCredentials();
  if (!creds) return DENIED;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isFounder(user.email, configuredFounders())) return DENIED;

  // Scoped to the signed-in user, which is safe here: reaching this line
  // already required a session on an allowlisted address, so the bucket
  // cannot be chosen by an attacker.
  const limit = await checkRateLimit("opsUnlock", user.id);
  // UNLIKE EVERY OTHER CALLER, an unavailable limiter is a refusal. The other
  // limits protect a cost and fail open so a database wobble does not break
  // the product; this one is the only thing between a guessed six-digit code
  // and every customer's wallet, and it fails closed.
  if (!limit.allowed || limit.count === null) {
    await record(user.id, user.email, "ops_unlock_throttled");
    return NextResponse.json({ error: "too many attempts, wait a while" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const ok = verifyTotp(creds.totpSecret, String(body?.code ?? ""));
  await record(user.id, user.email, ok ? "ops_unlock_success" : "ops_unlock_failed");
  if (!ok) return DENIED;

  const value = issueAdminSession(user.email, creds.sessionSecret);
  if (!value) return DENIED;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict", // strict, not lax: nothing should ever link INTO the console
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
  });
  return res;
}

/** Never throws: a failed audit write must not decide whether someone gets in. */
async function record(userId: string, email: string, action: string): Promise<void> {
  try {
    await createServiceClient().from("audit_log").insert({
      actor: `ops:${userId}`,
      action,
      detail: { email },
    });
  } catch {
    /* the decision above stands regardless */
  }
}
