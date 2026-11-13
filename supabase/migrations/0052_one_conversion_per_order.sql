-- One conversion per order, for the sources nobody is watching.
--
-- Two endpoints record sales without a human in the loop, and neither could
-- tell a new order from the same order arriving again:
--
--   pixel  - a public beacon. Anyone can replay a purchase URL, and a customer
--            refreshing their thank-you page does it by accident.
--   store  - the Shopify webhook. Shopify retries on any non-2xx and makes no
--            promise of exactly-once delivery even on success.
--
-- Either way the same order became two sales, and revenue is the number the
-- agent uses to decide which ad is winning. A doubled order does not just
-- look wrong on a dashboard; it moves budget toward the wrong creative.
--
-- Enforced here rather than with a read-then-insert in the route, because two
-- deliveries of the same order arrive within milliseconds of each other and a
-- check in application code would let both through.
--
-- Scoped to these two sources on purpose. A manual sale typed in by the owner
-- may legitimately reuse a reference (two part-payments on one invoice), and
-- that path has a signed-in human and an ownership check behind it.

create unique index if not exists conversions_automated_order_idx
  on conversions (business_id, source, order_ref)
  where order_ref is not null and source in ('pixel', 'store');
