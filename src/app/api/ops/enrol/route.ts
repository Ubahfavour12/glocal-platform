import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { configuredFounders, isFounder } from "@/lib/admin/access";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, issueAdminSession } from "@/lib/admin/session";
import { base32Decode, verifyTotp } from "@/lib/admin/totp";
import { enrolOpsCredentials, opsEnrolled } from "@/lib/admin/credentials";

/**
 * Save a second factor, once, after proving it works.
 *
 * THE ORDER IS THE SAFETY PROPERTY. The code is verified against the
 * SUBMITTED secret before anything is stored, so the only way to enrol a
 * secret is to demonstrate you already hold it. A key that never reached the
 * phone cannot become the one that locks everybody out.
 *
 * FIRST RUN ONLY. Once a credential exists this refuses, whoever is asking.
 * Replacing a second factor must not be something a single compromised inbox
 * can do; that needs a deliberate reset with access to the database.
 *
 * The secret arrives from the client, which sounds wrong and is not: it was
 * generated server-side moments earlier, it is worthless without the matching
 * code, and the alternative -- parking it in a server session between two
 * requests -- would mean storing an unconfirmed secret, which is the thing
 * being avoided. It is still validated here rather than trusted: a caller
 * could otherwise enrol a secret shaped like anything at all.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isFounder(user.email, configuredFounders())) {
    return NextResponse.json({ error: "that did not work" }, { status: 401 });
  }

  if (await opsEnrolled()) {
    return NextResponse.json(
      { error: "a second factor is already set up" },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    totpSecret?: string;
    sessionSecret?: string;
  } | null;

  const totpSecret = String(body?.totpSecret ?? "").trim();
  const sessionSecret = String(body?.sessionSecret ?? "").trim();

  // Never store something that cannot later authenticate anyone. A secret
  // too short, not base32, or a signing key with no entropy would enrol
  // successfully and then refuse every code forever.
  let decoded = 0;
  try {
    decoded = base32Decode(totpSecret).length;
  } catch {
    decoded = 0;
  }
  if (decoded < 16 || sessionSecret.length < 32) {
    return NextResponse.json({ error: "that did not work" }, { status: 400 });
  }

  if (!verifyTotp(totpSecret, String(body?.code ?? ""))) {
    return NextResponse.json(
      { error: "that code did not match — check the key and try the next one" },
      { status: 401 },
    );
  }

  const saved = await enrolOpsCredentials(totpSecret, sessionSecret, user.email);
  if (!saved.ok) {
    return NextResponse.json({ error: "could not save, try again" }, { status: 500 });
  }

  try {
    await createServiceClient().from("audit_log").insert({
      actor: `ops:${user.id}`,
      action: "ops_enrolled",
      detail: { email: user.email },
    });
  } catch {
    /* the enrolment stands regardless */
  }

  // Straight in, rather than asking for a second code they would have to
  // wait thirty seconds for. They have just proved they hold the phone.
  const value = issueAdminSession(user.email, sessionSecret);
  const res = NextResponse.json({ ok: true });
  if (value) {
    res.cookies.set(ADMIN_COOKIE, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
    });
  }
  return res;
}
