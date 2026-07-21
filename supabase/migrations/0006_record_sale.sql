-- 0006: mark-as-sold — the seller records a whole order, safely.
-- Loophole fixes locked 2026-07-21:
--   * "none" is a valid attribution (repeat customer / direct buyer);
--     unattributed sales count for totals + preference learning only.
--   * An attributed sale must reference one of THIS business's own smart-link
--     codes — no crediting someone else's ad, no invented codes.
-- Writes go through a SECURITY DEFINER function (house rule for
-- money-adjacent writes); RLS stays closed for direct inserts.

alter table conversions
  add column if not exists ad_code text,
  add column if not exists code_source text not null default 'none'
    check (code_source in ('message', 'seller_pick', 'none'));

create or replace function record_sale(
  p_business_id uuid,
  p_code text,                    -- smart-link code, or null when unattributed
  p_code_source text,             -- message | seller_pick | none
  p_value_usd_minor bigint,       -- FULL order total, minor units
  p_quantity int default null,
  p_items jsonb default null,
  p_order_ref text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_click uuid;
  v_id uuid;
begin
  select owner_id into v_owner from businesses where id = p_business_id;
  if v_owner is null or v_owner <> auth.uid() then
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
    -- best-effort click linkage: most recent click on that ad's link
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

revoke all on function record_sale(uuid, text, text, bigint, int, jsonb, text) from public;
grant execute on function record_sale(uuid, text, text, bigint, int, jsonb, text) to authenticated;
