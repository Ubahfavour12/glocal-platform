-- The founder console's second factor, held server-side instead of in env vars.
--
-- WHY IT MOVED. The TOTP seed lived in ADMIN_TOTP_SECRET, which meant setting
-- it up required a terminal, the repository, and a machine you trust -- and
-- the first time it was actually needed, the founder was away from that
-- machine and simply could not get in. A security control nobody can enrol is
-- not a security control; it is a locked door with the key in another city.
--
-- IS A TABLE WEAKER THAN AN ENV VAR? No, and it is worth being precise. Both
-- are readable by anything running with server credentials. An attacker who
-- can read this row already holds the service-role key, and with it every
-- customer's wallet, address and spend -- the exact thing the second factor
-- protects. The seed is not the weak link in that scenario; it is irrelevant
-- to it. What the table buys is real: enrolment from a phone, rotation
-- without a deploy, and a record of when and by whom.
--
-- A SINGLETON, enforced by a primary key with one legal value. A second row
-- would mean two valid secrets, and nothing in the code would say which one
-- an attacker was holding.

create table if not exists ops_credentials (
  -- The only permitted value. Belt and braces against a second credential
  -- quietly existing.
  id boolean primary key default true check (id),
  -- Base32, as authenticator apps spell it.
  totp_secret text not null,
  -- Signs the console's own session cookie. Rotating this signs every open
  -- console out at once, which is also how a session gets revoked.
  session_secret text not null,
  enrolled_at timestamptz not null default now(),
  enrolled_by text not null,
  -- Bumped on every successful unlock, purely so a glance at this row says
  -- whether the console is actually being used by anyone.
  last_unlock_at timestamptz
);

alter table ops_credentials enable row level security;
-- No policy, deliberately: nothing reaches this table through the API. It is
-- read and written by the server with the service role only. A customer
-- cannot read it, and neither can an authenticated founder's browser.
