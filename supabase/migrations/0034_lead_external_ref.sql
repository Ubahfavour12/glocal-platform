-- Stop the same lead being counted twice.
--
-- Meta retries a webhook until it receives a 200. A retry that arrives while
-- the first write is still in flight creates the lead again, and nothing in
-- 0033 prevented that — an oversight, since the dedupe key existed in the code
-- with nowhere to be stored.
--
-- Double-counting is not a cosmetic problem here. Lead counts feed cost-per-won
-- and the budget ranking, so a duplicated lead makes a creative look like it
-- produced business it did not, and money follows that conclusion.

alter table leads add column external_ref text;

/**
 * Unique per business, not globally.
 *
 * Scoped to the business because the reference comes from an outside system and
 * we do not control its namespace. A global constraint would mean one
 * customer's provider id could block another customer's lead from being
 * recorded — a cross-tenant failure caused entirely by a coincidence.
 *
 * Partial, so the many leads with no external reference (entered by hand, or
 * arriving from a channel that gives us no id) do not all collide on NULL.
 */
create unique index leads_external_ref_unique
  on leads (business_id, external_ref)
  where external_ref is not null;
