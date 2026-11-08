-- The enrolment in progress, so the key on the screen stops moving.
--
-- THE BUG THIS FIXES, PLAINLY. The enrolment page is force-dynamic and
-- generated a fresh secret on every render. The form carried the secret from
-- the render it was submitted from, so the sequence that any human actually
-- performs -- open the page, switch to the authenticator app, type the key,
-- switch back, type the code -- failed whenever coming back re-fetched the
-- page, which mobile browsers routinely do for an uncached page. The key on
-- screen was then a DIFFERENT key from the one in the phone, and the code
-- could never match. Nothing in the message said so; it just read as a wrong
-- code, forever, for a key that was typed in perfectly.
--
-- So the candidate secret has to outlive a page view, which means it has to
-- live somewhere. Here, for a short while, as a candidate and nothing else.
--
-- HOW THIS KEEPS THE SAFETY PROPERTY. The old comment promised that nothing
-- is stored until a correct code proves the key reached the phone. That
-- promise was about one specific danger: a secret nobody holds becoming the
-- one that locks everybody out. It still holds, and this is why -- the gate
-- reads `ops_credentials` and never this table, so a row here authenticates
-- nobody and unlocks nothing. Only a correct code promotes it, and promotion
-- is the only path into `ops_credentials`.
--
-- What is genuinely new: an unconfirmed secret sits in the database for up to
-- half an hour. An attacker who could read it would need the service-role key,
-- and with that they could read the confirmed secret too -- so it adds no
-- exposure that matters, and it buys a flow a person can actually complete.

create table if not exists ops_pending_enrolment (
  -- Singleton, like ops_credentials: two candidates at once would mean two
  -- keys that might promote, and no way to say which one a phone holds.
  id boolean primary key default true check (id),
  totp_secret text not null,
  session_secret text not null,
  started_at timestamptz not null default now(),
  started_by text not null
);

alter table ops_pending_enrolment enable row level security;
-- No policy, deliberately. Service role only, exactly like ops_credentials.

/**
 * Hand back the candidate in force, creating one only if there is none.
 *
 * The caller generates a fresh pair every time and offers it; this returns
 * either that pair (because there was nothing recent) or the pair already in
 * flight. That inversion is the point: the page can re-render as often as it
 * likes and the key on screen will not move for half an hour.
 *
 * Serialized on an advisory lock, because two renders racing -- a reload while
 * the first request is still in flight -- would otherwise each insert and one
 * would win silently, which is the bug again with extra steps.
 */
create or replace function begin_ops_enrolment(
  p_totp_secret text,
  p_session_secret text,
  p_started_by text,
  p_ttl_minutes integer default 30
)
returns table (totp_secret text, session_secret text, started_at timestamptz, reused boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_totp text;
  v_session text;
  v_started timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('ops_pending_enrolment'));

  -- A candidate older than the window is abandoned, not reused: whoever
  -- started it has long since closed the tab.
  delete from ops_pending_enrolment p
   where p.started_at < now() - make_interval(mins => p_ttl_minutes);

  -- Written as explicit steps rather than one clever statement with CTEs: a
  -- data-modifying CTE reads the snapshot from before its own insert, which
  -- is a trap I have already fallen into once in this schema.
  select p.totp_secret, p.session_secret, p.started_at
    into v_totp, v_session, v_started
    from ops_pending_enrolment p;

  if v_totp is null then
    insert into ops_pending_enrolment (id, totp_secret, session_secret, started_by)
    values (true, p_totp_secret, p_session_secret, p_started_by)
    returning ops_pending_enrolment.totp_secret,
              ops_pending_enrolment.session_secret,
              ops_pending_enrolment.started_at
      into v_totp, v_session, v_started;
    return query select v_totp, v_session, v_started, false;
  else
    return query select v_totp, v_session, v_started, true;
  end if;
end;
$$;

revoke all on function begin_ops_enrolment(text, text, text, integer) from public;
revoke all on function begin_ops_enrolment(text, text, text, integer) from anon, authenticated;
grant execute on function begin_ops_enrolment(text, text, text, integer) to service_role;
