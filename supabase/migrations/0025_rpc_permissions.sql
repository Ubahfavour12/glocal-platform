-- Close two holes in the customer-facing RPCs.
--
-- Found by Supabase's own security advisor after 0021-0024 went in. Neither is
-- new; both predate today's work.

/**
 * 1. record_sale could be called WITHOUT SIGNING IN, and its ownership check
 *    did not stop it.
 *
 * The check read:
 *
 *   if v_owner is null or v_owner <> auth.uid() then raise exception ...
 *
 * which looks right and is not. For an anonymous caller auth.uid() is NULL, so
 * `v_owner <> NULL` evaluates to NULL rather than true, `false OR NULL` is
 * NULL, and `IF NULL THEN` does not fire. The guard silently passes for exactly
 * the caller it exists to stop. Signed-in callers were always checked properly,
 * which is why this never showed up in use.
 *
 * The consequence was real: anyone who knew a business id could POST to
 * /rest/v1/rpc/record_sale and insert conversions. Those rows are what the duel
 * judges ads on, so forged sales would decide which creative wins and how the
 * budget gets spent.
 *
 * Fixed two ways, because either alone would have been enough and neither
 * should be the only thing standing there:
 *   - `is distinct from` is NULL-safe, so the guard now fires for anon.
 *   - anon loses EXECUTE entirely; nothing anonymous should reach this.
 */
create or replace function record_sale(
  p_business_id uuid,
  p_code text,
  p_code_source text,
  p_value_usd_minor bigint,
  p_quantity integer default null,
  p_items jsonb default null,
  p_order_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_click uuid;
  v_id uuid;
begin
  select owner_id into v_owner from businesses where id = p_business_id;
  -- `is distinct from` rather than `<>`: NULL-safe, so an anonymous caller
  -- (auth.uid() = NULL) is refused instead of slipping through on NULL logic.
  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'not your business';
  end if;
  if p_value_usd_minor is null or p_value_usd_minor <= 0 then
    raise exception 'order value must be a positive amount';
  end if;
  if p_code_source not in ('message', 'seller_pick', 'none') then
    raise exception 'invalid code source';
  end if;

  if p_code_source = 'none' then
    if p_code is not null then
      raise exception 'unattributed sale must not carry an ad code';
    end if;
  else
    if p_code is null then
      raise exception 'attributed sale needs its ad code';
    end if;
    if not exists (
      select 1 from smart_links
      where code = p_code and business_id = p_business_id
    ) then
      raise exception 'unknown ad code for this business';
    end if;
    select ce.id into v_click
      from click_events ce
      join smart_links sl on sl.id = ce.smart_link_id
      where sl.code = p_code and sl.business_id = p_business_id
      order by ce.created_at desc limit 1;
  end if;

  insert into conversions
      (business_id, click_event_id, kind, order_ref, value_usd_minor,
       quantity, items, source, ad_code, code_source)
    values
      (p_business_id, v_click, 'verified_order', p_order_ref, p_value_usd_minor,
       p_quantity, p_items, 'manual', p_code, p_code_source)
    returning id into v_id;
  return v_id;
end $$;

-- Signed-in sellers still record their own sales; nobody anonymous can.
revoke execute on function record_sale(uuid, text, text, bigint, integer, jsonb, text)
  from anon;

/**
 * 2. Anonymous EXECUTE on the other customer RPCs.
 *
 * ensure_wallet, record_dev_topup and respond_to_approval all check ownership
 * correctly (ensure_wallet and respond_to_approval were already NULL-safe, and
 * record_dev_topup is covered because it calls ensure_wallet before touching
 * anything). So this is not closing a live hole, it is removing reachability
 * that has no reason to exist: an anonymous caller has no business at these
 * endpoints even when they would be refused on arrival.
 *
 * `authenticated` keeps EXECUTE because the app's routes call these as the
 * signed-in user.
 */
revoke execute on function ensure_wallet(uuid) from anon;
revoke execute on function record_dev_topup(uuid, bigint) from anon;
revoke execute on function respond_to_approval(uuid, text) from anon;

/**
 * 3. forbid_ledger_mutation had no fixed search_path.
 *
 * It is the trigger that keeps ledger_entries append-only. A trigger function
 * without a pinned search_path can be made to resolve objects somewhere else,
 * and this one guards the money.
 */
create or replace function forbid_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ledger_entries is append-only';
end $$;
