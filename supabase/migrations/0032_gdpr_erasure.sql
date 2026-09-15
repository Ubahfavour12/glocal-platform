-- "Delete my account", against a ledger that cannot be deleted from.
--
-- Two obligations point in opposite directions and both are real.
--
-- GDPR Article 17 gives a customer the right to erasure. We have no way to
-- honour it at all today: there is no delete path anywhere in the product, which
-- is its own finding — the right does not require a self-serve button, but it
-- does require that the request can be carried out.
--
-- Against that, `ledger_entries` is append-only by trigger and is the financial
-- record of money we took, spent on ads, and owe. UK company and tax law
-- requires keeping those records for six years. Deleting them on request would
-- not be compliance, it would be destroying accounting records.
--
-- Article 17(3) resolves it rather than leaving it a standoff. The right to
-- erasure does not apply where processing is necessary for compliance with a
-- legal obligation (17(3)(b)) or for the establishment, exercise or defence of
-- legal claims (17(3)(e)). Financial records are squarely both.
--
-- So erasure here means: DESTROY the personal data, KEEP the financial record,
-- and sever the link between them. What remains is a row saying "$40 was spent
-- on ads on 3 March" attached to an identifier that no longer resolves to a
-- person. That is pseudonymisation under Article 4(5), and it is the standard
-- answer for exactly this collision.
--
-- What is destroyed outright, because none of it is an accounting record:
--   - the auth user (email, phone) — the identity itself
--   - OAuth access tokens, shop domains and webhook secrets, which are
--     credentials and should not outlive the account by one second
--   - the business name, its destination URL or WhatsApp number, its strategy
--     profile, uploaded media, generated concepts and creatives
--   - click events, which are the SMB's OWN customers' data (user agent,
--     coarse geo) and which we hold as a processor with no reason to keep
--
-- What survives, pseudonymised:
--   - ledger_entries, wallets, withdrawals, subscriptions, budget_holds
--   - conversions, stripped of order references and item detail, because the
--     VALUE is revenue evidence while the basket is not

/**
 * FIRST, the thing that made erasure impossible: owner_id's cascade.
 *
 * `businesses.owner_id` was `not null references auth.users(id) on delete
 * cascade`. That produced two different wrong answers depending on whether the
 * customer had ever paid us, and both were found by trying it rather than by
 * reading it:
 *
 *   - A business WITH ledger entries: deleting the auth user FAILS. The chain
 *     is auth.users -> businesses -> wallets -> ledger_entries, and the ledger's
 *     own ON DELETE RESTRICT stops it. The money was safe, but the error is a
 *     raw foreign-key violation naming a table the customer has never heard of,
 *     and there is no way to complete the request.
 *   - A business with NO ledger entries: deleting the auth user SUCCEEDS and
 *     silently takes the business and its subscription row with it. A
 *     subscription is a record of money we charged. That is an accounting
 *     record disappearing because somebody clicked delete in a dashboard.
 *
 * So the cascade is replaced with SET NULL and the column made nullable.
 * Removing the identity now pseudonymises the business rather than destroying
 * it, consistently, whether or not money ever moved. It also makes deleting a
 * user from the Supabase dashboard safe, which it currently is not.
 *
 * RLS needs no change: every policy reads `owner_id = auth.uid()`, and NULL
 * never equals anything, so an erased business becomes invisible to every
 * signed-in user rather than accessible to the wrong one.
 */
alter table businesses alter column owner_id drop not null;
alter table businesses drop constraint businesses_owner_id_fkey;
alter table businesses
  add constraint businesses_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete set null;

/**
 * Erase a business, keeping only what the law requires us to keep.
 *
 * Service role only, and deliberately not callable from a browser session. A
 * signed-in user reaches it through a route that checks ownership first; making
 * the SQL itself unreachable from the client means a stolen session token
 * cannot destroy an account on its own.
 *
 * Refuses while there is money in the wallet or a withdrawal in flight. Erasing
 * then would strand funds that belong to the customer behind an identifier that
 * no longer resolves to anyone — the money becomes unreturnable at the exact
 * moment they stop being able to ask for it. They withdraw first, then erase.
 */
create or replace function erase_business(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_owner uuid;
  v_wallet uuid;
  v_balance bigint;
  v_pending integer;
  v_removed jsonb;
begin
  select owner_id into v_owner from businesses where id = p_business_id;
  if v_owner is null then
    raise exception 'no such business';
  end if;

  select id into v_wallet from wallets where business_id = p_business_id;

  -- Money first. Both checks are refusals, not warnings: there is no way to
  -- give the money back afterwards.
  if v_wallet is not null then
    select coalesce(balance_usd_minor, 0) into v_balance
    from wallet_balances where wallet_id = v_wallet;
    if coalesce(v_balance, 0) > 0 then
      raise exception 'wallet still holds % minor units — withdraw before erasing', v_balance;
    end if;
  end if;

  select count(*) into v_pending
  from withdrawals where business_id = p_business_id and status = 'requested';
  if v_pending > 0 then
    raise exception 'a withdrawal is still in flight — wait for it to settle before erasing';
  end if;

  -- Credentials go first, so that a failure part-way through has already
  -- revoked the things that would be worst to leave behind.
  delete from social_connections where business_id = p_business_id;
  delete from store_connections where business_id = p_business_id;

  -- The SMB's own customers' data. We hold this as a processor; when the
  -- controller relationship ends there is no basis to keep it at all.
  delete from click_events
  where smart_link_id in (select id from smart_links where business_id = p_business_id);

  -- Content and generated material. Not accounting records.
  delete from media_assets where business_id = p_business_id;
  delete from compliance_scans
  where creative_id in (select id from creatives where business_id = p_business_id);
  delete from ai_generations where business_id = p_business_id;
  delete from creatives where business_id = p_business_id;
  delete from concepts where business_id = p_business_id;
  delete from journal_entries where business_id = p_business_id;
  delete from approvals where business_id = p_business_id;
  delete from rejections
  where ad_id in (
    select a.id from ads a
    join campaigns c on c.id = a.campaign_id
    where c.business_id = p_business_id
  );

  -- Conversions are revenue evidence, so the amount stays. The basket and the
  -- merchant's order reference are the customer's, and are not.
  update conversions
  set items = null, order_ref = null, ad_code = null, click_event_id = null
  where business_id = p_business_id;

  -- Smart links carry a destination — a website or a WhatsApp number.
  update smart_links
  set destination = '', destination_kind = 'erased'
  where business_id = p_business_id;

  -- The business row itself is kept because the financial rows point at it, but
  -- everything identifying is overwritten. The name becomes a stable, opaque
  -- label so statements and the founder console still render a row rather than
  -- a blank, without naming anybody.
  update businesses
  set name = 'erased-' || left(replace(p_business_id::text, '-', ''), 8),
      destination = null,
      strategy_profile = null,
      service_geo = '{}'::jsonb,
      category = 'erased',
      country = null,
      founded_year = null,
      full_auto = false
  where id = p_business_id;

  -- Audit entries name the actor and can carry detail about them.
  delete from audit_log where business_id = p_business_id;

  -- Finally the identity. Deleting the auth user is what actually makes the
  -- remaining rows pseudonymous rather than merely renamed: without it, the
  -- owner_id still resolves to an email address.
  delete from auth.users where id = v_owner;
  -- The FK above is ON DELETE SET NULL, so owner_id is already null by the time
  -- this runs. Stated explicitly anyway: this is the line that makes every
  -- surviving financial row pseudonymous rather than merely renamed, and it
  -- should not depend on a reader knowing the constraint by heart.
  update businesses set owner_id = null where id = p_business_id;

  v_removed := jsonb_build_object(
    'business_id', p_business_id,
    'erased_at', now(),
    'retained', 'ledger_entries, wallets, withdrawals, subscriptions, budget_holds, conversion values'
  );

  -- Recorded WITHOUT a business_id, so this row is not itself deleted by a
  -- future erasure and does not re-link anything. It is the evidence that the
  -- request was carried out, which is its own compliance obligation.
  insert into audit_log (business_id, actor, action, detail)
  values (null, 'system', 'gdpr_erasure', v_removed);

  return v_removed;
end $$;

revoke all on function erase_business(uuid) from public, anon, authenticated;
grant execute on function erase_business(uuid) to service_role;

/**
 * Time-bound the SMB's customers' click data, independently of erasure.
 *
 * `click_events` records a user agent and a coarse geo for every click on a
 * tracked ad — people who never had any relationship with us and cannot ask us
 * for anything. Storage minimisation (Article 5(1)(e)) says keep it only as
 * long as it is needed, and it is needed to attribute a conversion, which
 * happens within days. Ninety days is generous for that and far short of
 * forever, which is what "no policy" means in practice.
 */
create or replace function prune_click_events(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_deleted integer;
begin
  delete from click_events
  where created_at < now() - make_interval(days => greatest(p_days, 1))
    and id not in (select click_event_id from conversions where click_event_id is not null);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function prune_click_events(integer) from public, anon, authenticated;
grant execute on function prune_click_events(integer) to service_role;
