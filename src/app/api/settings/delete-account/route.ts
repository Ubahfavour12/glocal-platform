import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { log, requestId } from "@/lib/log";

/**
 * Erase the signed-in customer's account (GDPR Article 17).
 *
 * Until now there was no way to honour an erasure request at all — not a
 * missing button, a missing capability. The right does not require self-serve,
 * but it does require that the request can be carried out, and it could not be:
 * deleting the auth user either failed on a foreign key or silently took the
 * business and its subscription record with it, depending on whether the
 * customer had ever paid us.
 *
 * WHAT ERASURE MEANS HERE. Personal data is destroyed; the financial record is
 * kept and unlinked. Article 17(3) allows exactly this — erasure does not apply
 * where processing is necessary for a legal obligation or for defending legal
 * claims, and UK company and tax law requires keeping accounting records for
 * six years. So the ledger survives attached to an identifier that no longer
 * resolves to a person. `docs/` carries the full policy; `erase_business` in
 * migration 0032 is the authority on what goes and what stays.
 *
 * The SQL is service-role only and unreachable from a browser. This route is
 * the only way in, and it checks ownership first, so a stolen session token
 * cannot reach the erasure function directly.
 */
export async function POST(req: NextRequest) {
  const rid = requestId(req.headers);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  // Typing the phrase is the confirmation. This is the one action in the
  // product with no undo — the auth user is gone and the remaining rows are
  // deliberately no longer traceable to them — so it should not be reachable by
  // a mis-click or a CSRF-shaped request that a bare POST would satisfy.
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE MY ACCOUNT") {
    return NextResponse.json(
      { error: 'type "DELETE MY ACCOUNT" to confirm' },
      { status: 400 },
    );
  }

  // Read through the USER's client, not the service client: RLS then proves
  // ownership rather than this route asserting it.
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return NextResponse.json({ error: "no business" }, { status: 404 });

  const service = createServiceClient();
  const { data, error } = await service.rpc("erase_business", {
    p_business_id: business.id,
  });

  if (error) {
    // The refusals are deliberate and the customer needs to see them: money
    // still in the wallet, or a withdrawal in flight. Erasing through either
    // would strand funds behind an identifier that no longer resolves to
    // anyone, at the exact moment they lose the ability to ask for them.
    log.error("erasure.failed", { rid, business: business.id, reason: error.message });
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  log.info("erasure.done", { rid, business: business.id });

  // Sign out last. The session belongs to a user who no longer exists; leaving
  // it live would give a token authority over an account that is gone.
  await supabase.auth.signOut();

  return NextResponse.json({ erased: true, detail: data });
}
