-- Let somebody finish signing up on a different device.
--
-- The half-finished run is kept in localStorage, which is per-BROWSER. Start
-- on a phone in the shop and open the laptop at home and it is gone; clear
-- browsing data and it is gone; use the browser inside an email app and the
-- draft lives somewhere you will never return to. For this market that is not
-- an edge case -- a good share of these customers are on a borrowed or shared
-- machine, which is also why the draft is stamped with an owner in the first
-- place.
--
-- So the draft follows the ACCOUNT as well as the browser. localStorage stays:
-- it is instant, it works before the session resolves, and it is the only copy
-- in demo mode. This table is the one that survives the device.
--
-- One row per user, overwritten in place. There is no value in a history of
-- abandoned signups, and keeping one would mean keeping somebody's phone
-- number and business plans long after they walked away.
--
-- Cascades with the auth user, so erasure takes it without erase_business
-- needing to know this table exists.

create table if not exists onboarding_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- The same shape the client holds: phase, name, trade, country, door,
  -- goal, budget. Deliberately opaque to the database -- this is a resume
  -- point, not a record, and every field is already modelled on `businesses`
  -- for the moment it becomes one.
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table onboarding_drafts enable row level security;

-- Read and write your own, and nobody else's. Unlike most tables here the
-- customer writes this one directly: it changes on every screen of a
-- seven-screen flow, and routing that through an API route would add a
-- round trip to each keystroke without adding a single check that this
-- policy does not already make.
create policy "own draft" on onboarding_drafts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
