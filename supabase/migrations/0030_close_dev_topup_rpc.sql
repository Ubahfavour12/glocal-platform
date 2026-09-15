-- Deleting the route did not delete the endpoint.
--
-- `POST /api/wallet/topup` was retired and now answers 410. Its own comment
-- reasoned that "what matters is that nothing reachable calls it" — and that
-- premise is wrong. PostgREST exposes EVERY function in `public` that has
-- EXECUTE granted, at `/rest/v1/rpc/<name>`. `record_dev_topup` still had
-- EXECUTE granted to `authenticated`, so it stayed directly callable with the
-- publishable key that ships in the browser bundle plus any signed-in session.
-- The Next.js route was never the thing standing in the way.
--
-- What that bought a caller: `ensure_wallet` does check ownership, so nobody
-- could credit somebody else's wallet. But anyone could credit THEIR OWN — 200
-- minor units to 20,000 a call, up to a 100,000 lifetime cap. That is $200 of
-- spendable ad budget per business, minted with no payment, on money that is
-- real once the agent spends it on Meta and once a wallet balance can be
-- withdrawn. It is the same mechanism that put money the business had never
-- paid for into a wallet before.
--
-- Nothing in the app calls this. The app's real top-up path is the payment
-- provider webhook, which runs as `service_role`.

/**
 * Revoke, rather than drop.
 *
 * The function is left in place because `ledger_entries` is append-only and
 * still holds rows noted 'dev-topup' from testing. Dropping the function would
 * not remove those, but keeping it makes the history legible: the rows point at
 * something that still exists and explains itself. What changes is that no
 * browser-reachable role can invoke it any more.
 *
 * `service_role` is not granted either. Nothing should call this, including the
 * server. If test money is ever genuinely needed again, it should be an
 * explicit, deliberate grant at that moment — not a door left ajar because it
 * was convenient once.
 */
revoke all on function record_dev_topup(uuid, bigint) from public, anon, authenticated, service_role;
