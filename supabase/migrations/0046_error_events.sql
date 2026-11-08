-- Somewhere a production exception can be seen.
--
-- log.ts writes structured JSON to stdout, Vercel keeps it briefly, and nobody
-- reads it at 2am. There is no alerting, no grouping and no history, so the
-- honest description of today is: when something breaks in production, the
-- first you hear of it is a customer telling you.
--
-- ONE ROW PER DISTINCT FAULT, not one per occurrence. A raw stream is not
-- monitoring -- a single bad deploy writes ten thousand identical lines and
-- buries the one rare error that matters. Collapsing on a fingerprint turns
-- "something is wrong" into "this is wrong, 412 times, since Tuesday, on this
-- route", which is a thing a person can act on at a glance.
--
-- Deliberately not Sentry. Sentry is better at this and should happen; it
-- needs an account, a DSN, a package and a paid tier to retain anything. This
-- needs none of those and works tonight, in the console the founder already
-- opens. The two are not exclusive.
--
-- No business_id: most of these happen before or outside any business
-- context, and an errors table that only captures the ones with a customer
-- attached would miss every boot failure and every cron.

create table if not exists error_events (
  fingerprint text primary key,
  message text not null,
  digest text,
  route text,
  method text,
  route_type text,
  stack text,
  seen_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists error_events_last_seen_idx
  on error_events (last_seen_at desc);

alter table error_events enable row level security;
-- No policy at all: nothing reaches this table through the API. It is written
-- by the server with the service role and read by the founder console, which
-- already uses the service role behind its own allowlist. A customer has no
-- business reading another customer's stack traces.

/**
 * Record one occurrence.
 *
 * Upsert-with-increment, which supabase-js cannot express: `upsert` would
 * overwrite the count rather than add to it, and a read-then-write would lose
 * occurrences whenever two requests fail at the same moment -- which is
 * exactly what happens during the incident you most want counted.
 *
 * The message and stack are refreshed on each hit so the row carries the most
 * recent example rather than the oldest.
 */
create or replace function record_error_event(
  p_fingerprint text,
  p_message text,
  p_digest text,
  p_route text,
  p_method text,
  p_route_type text,
  p_stack text
) returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  insert into error_events (
    fingerprint, message, digest, route, method, route_type, stack
  )
  values (
    p_fingerprint, p_message, p_digest, p_route, p_method, p_route_type, p_stack
  )
  on conflict (fingerprint) do update set
    seen_count = error_events.seen_count + 1,
    last_seen_at = now(),
    message = excluded.message,
    digest = excluded.digest,
    stack = excluded.stack;
$fn$;

revoke all on function record_error_event(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function record_error_event(text, text, text, text, text, text, text)
  to service_role;
