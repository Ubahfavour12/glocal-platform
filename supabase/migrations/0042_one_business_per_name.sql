-- One business per owner per name.
--
-- Five of ten accounts owned duplicate businesses, each set created within two
-- seconds of itself: a double-tap on "Finish setting up". `finish()` guarded on
-- React state, and state cannot close that window -- two clicks dispatched
-- before React commits the disabled button both read `saving: false` and both
-- insert. A `useRef` guard now closes the window this browser can see; this
-- index closes the ones it cannot: a second tab, a retried request, a future
-- API.
--
-- The cost was not a stray row. Each duplicate accumulated a full 50-concept
-- pool and 83 nightly approval plans, all written by a Sonnet-class model for a
-- business nobody would ever open. That is most of the otherwise unexplained
-- "1,033 plans generated, 0 ads created" in production.
--
-- `lower(name)` because "Global" and "global" are the same shop.
--
-- WHEN TO REVISIT. Today this is free: onboarding holds the only insert into
-- `businesses` in the codebase, so nobody can legitimately want a second
-- business with the same name. The day an "add another business" flow exists,
-- decide deliberately whether two branches may share a name -- and if they may,
-- replace this with an idempotency key rather than simply dropping it. Dropping
-- it alone puts the duplicates back.

create unique index if not exists businesses_owner_name_idx
  on businesses (owner_id, lower(name));
