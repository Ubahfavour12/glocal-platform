-- Erasure could not actually erase.
--
-- THE BUG. `ai_generations` is append-only, enforced by a row trigger that
-- raises on UPDATE or DELETE (migration 0027). `erase_business` deletes from
-- that table (migration 0032). So the moment a business has a single logged
-- generation, erasure raises `ai_generations is append-only` and the whole
-- transaction rolls back. Nothing is erased, and the customer is told their
-- account could not be closed.
--
-- The two migrations were written three apart and each is right on its own.
-- Together they mean the right to erasure works only for customers who never
-- used the product -- which is the exact opposite of who needs it. /privacy
-- promises data is "erased immediately when you close it", and the delete
-- route's own comment says the right "does require that the request can be
-- carried out". It could not be.
--
-- Caught while deleting duplicate business rows, not by anyone exercising the
-- right, because only one row in production has a generation logged against
-- it. The first real customer to render a creative and then close their
-- account would have found it instead.
--
-- THE FIX, and why not the obvious one. Dropping DELETE from the trigger would
-- work and would give up the guarantee: the table would then be append-only by
-- RLS alone, and any future service-role path could quietly remove rows from a
-- compliance log. Instead, deletion stays forbidden except inside an erasure,
-- marked by a transaction-local flag that `erase_business` sets and nothing
-- else does. The exception is narrow, deliberate and greppable.
--
-- `set_config(..., true)` is transaction-local: it cannot leak to the next
-- statement on a pooled connection, and a transaction that rolls back takes
-- the flag with it.

create or replace function forbid_generation_mutation() returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- The one lawful reason to remove a row from a compliance log is that the
  -- person it concerns has asked to be erased. UPDATE stays forbidden
  -- unconditionally: editing the record after the fact is the thing the log
  -- exists to make impossible, and no erasure needs it.
  if tg_op = 'DELETE' and coalesce(current_setting('glocal.erasing', true), 'off') = 'on' then
    return old;
  end if;
  raise exception 'ai_generations is append-only';
end $$;

-- Re-emitted from migration 0032 with ONE added line: the set_config before
-- the content deletes. The rest is unchanged, and the live definition was
-- compared against 0032 before this was written.

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

  -- THE ADDED LINE. Unlocks DELETE on ai_generations for this transaction
  -- only. Set after the money checks on purpose: a refusal above must not have
  -- quietly unlocked anything, even though the rollback would undo it anyway.
  perform set_config('glocal.erasing', 'on', true);

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
