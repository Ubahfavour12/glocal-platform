-- Never ask the owner the same fact twice.
--
-- A WhatsApp seller already records the sale: that is how revenue attribution
-- works, and `record_sale` takes the ad code, resolves the click and stores the
-- value. Then the leads page asked them to go and mark the same deal won.
--
-- Asking twice is not merely annoying. The second question is the one that gets
-- skipped, and a skipped answer does not read as "unknown" — it reads as a lead
-- that never closed. Cost-per-won then gets quietly WORSE for the ad that
-- actually produced the business, and the budget moves away from it. The
-- feature meant to find the best ad would have been slowly punishing it.
--
-- So a recorded sale closes its lead by itself.
--
-- A TRIGGER, NOT A CHANGE TO record_sale. Sales arrive by three routes — the
-- seller's own entry, the website pixel, and the Shopify webhook — and they all
-- insert into `conversions`. Putting the rule at the table means one
-- implementation covering every route, including any added later, instead of
-- three copies that drift.

/**
 * Close, or create, the lead behind a sale.
 *
 * Matching is by CLICK first, then by ad code. The click is exact; the code
 * only says "some visit from this ad", which is the best available answer for
 * a WhatsApp conversation where no click id ever reaches us.
 *
 * When no lead exists, one is created already won. A sale attributed to an ad
 * is itself proof a lead existed — we simply never saw it, which is exactly the
 * WhatsApp case. Recording it as won with its value is more honest than leaving
 * the ad looking like it produced revenue from nobody.
 */
create or replace function close_lead_for_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_smart_link uuid;
begin
  -- Only real sales. A site session or a WhatsApp open is interest, not a
  -- closed deal, and treating one as a win would inflate every win rate.
  if new.kind <> 'verified_order' then
    return new;
  end if;

  -- An unattributed sale says nothing about any ad, so it must not close a
  -- lead: doing so would credit whichever lead happened to be open.
  if new.click_event_id is null and new.ad_code is null then
    return new;
  end if;

  if new.click_event_id is not null then
    select smart_link_id into v_smart_link from click_events where id = new.click_event_id;
  end if;

  if v_smart_link is null and new.ad_code is not null then
    select id into v_smart_link
    from smart_links
    where code = new.ad_code and business_id = new.business_id;
  end if;

  if v_smart_link is null then
    return new;
  end if;

  -- The oldest OPEN lead on this link. Oldest because a queue is served in
  -- order; open because an already-settled lead is somebody's explicit answer
  -- and must not be overwritten by a later sale.
  select id into v_lead_id
  from leads
  where business_id = new.business_id
    and smart_link_id = v_smart_link
    and status not in ('won', 'lost')
  order by created_at asc
  limit 1;

  if v_lead_id is not null then
    update leads
    set status = 'won',
        value_usd_minor = new.value_usd_minor,
        status_changed_at = now()
    where id = v_lead_id;

    insert into lead_events (lead_id, from_status, to_status, note)
    values (v_lead_id, null, 'won', 'closed automatically by a recorded sale');
    return new;
  end if;

  -- No lead to close: the conversation happened somewhere we could not see.
  -- The sale still proves it existed, so record it rather than losing the
  -- attribution.
  insert into leads (
    business_id, smart_link_id, click_event_id, ad_id, creative_id,
    source, attribution, label, status, value_usd_minor, external_ref
  )
  select
    new.business_id,
    v_smart_link,
    new.click_event_id,
    sl.ad_id,
    a.creative_id,
    'whatsapp',
    -- The sale carried the ad code, which the seller either read off a message
    -- or picked by hand. That is the same confidence as the prefill path, and
    -- calling it anything stronger would overstate what we know.
    'prefill',
    'Closed deal',
    'won',
    new.value_usd_minor,
    -- One lead per sale. Without this a corrected or re-entered sale would
    -- manufacture a second customer out of the same deal.
    'sale:' || new.id::text
  from smart_links sl
  left join ads a on a.id = sl.ad_id
  where sl.id = v_smart_link
  on conflict (business_id, external_ref) where external_ref is not null
  do nothing;

  return new;
end $$;

create trigger conversions_close_lead
  after insert on conversions
  for each row
  execute function close_lead_for_conversion();
