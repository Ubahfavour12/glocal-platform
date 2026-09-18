import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { log, requestId } from "@/lib/log";
import { MEDIA_BUCKET } from "@/lib/media/storage";
import { currentBusiness } from "@/lib/business/current";

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
  const business = await currentBusiness<{ id: string } & Record<string, unknown>>(
    supabase,
    "id",
  );
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

  // The photos themselves, which live in Storage rather than in a table.
  //
  // This runs AFTER the database erasure, not before, for two reasons. The
  // guards live in the SQL — money still in the wallet, a withdrawal in flight
  // — and deleting somebody's photos before finding out the erasure is refused
  // would destroy data while leaving the account standing. And the paths are
  // derivable without the `media_assets` rows the erasure has just removed,
  // because every upload is stored under a folder named for the business.
  //
  // Reported rather than thrown. By this point the erasure has succeeded and is
  // irreversible; failing the request now would tell the customer their
  // deletion did not happen when most of it did. Leftover files are a real gap,
  // so they are logged at error level to be chased, not swallowed.
  let filesRemoved = 0;
  try {
    const { data: files } = await service.storage.from(MEDIA_BUCKET).list(business.id, {
      limit: 1000,
    });
    const paths = (files ?? []).map((f) => `${business.id}/${f.name}`);
    if (paths.length > 0) {
      const { error: rmErr } = await service.storage.from(MEDIA_BUCKET).remove(paths);
      if (rmErr) throw rmErr;
      filesRemoved = paths.length;
    }
  } catch (e) {
    log.error("erasure.storage_failed", {
      rid,
      business: business.id,
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  log.info("erasure.done", { rid, business: business.id, filesRemoved });

  // Sign out last. The session belongs to a user who no longer exists; leaving
  // it live would give a token authority over an account that is gone.
  await supabase.auth.signOut();

  return NextResponse.json({ erased: true, detail: data, filesRemoved });
}
