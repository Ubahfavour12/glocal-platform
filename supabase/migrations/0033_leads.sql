-- Leads, and whether they turned into business.
--
-- WHY. Talking to a social media manager running ads for several brands, the
-- thing she named as the biggest pain point was LEAD QUALITY — not lead volume.
-- Asked how she tracks a lead through to a closed deal, the answer was: "we
-- just do it manually. I wouldn't call it tracking, I'd call it follow up."
--
-- Today Glocal cannot help with that at all. A Meta lead event already counts
-- as a conversion intent in the verdict engine, so the ad that produces the
-- CHEAPEST leads wins. That is precisely the wrong answer when the cheap leads
-- never close, which is the ordinary case and the reason "lead quality" is a
-- phrase people use with feeling.
--
-- So a lead becomes an object with a life: it is born attributed to the ad, and
-- therefore to the creative and the concept ANGLE that produced it, and it ends
-- won or lost. Once both ends exist you can say the thing nobody else says —
-- "this ad brought three times the leads; that one brought the money."
--
-- ON PERSONAL DATA, DELIBERATELY MINIMAL. Meta's lead forms hand over a name, a
-- phone number and an email. We do not store them. Becoming a database of our
-- customers' customers would cross the NDPA's 200-data-subject threshold on the
-- first day of real spend, inherit the matching GDPR duties, and make any
-- breach enormously worse — all to duplicate a contact the business already has
-- in WhatsApp. What is stored is a RECOGNITION LABEL: enough for the owner to
-- know which lead they are tapping, and useless to anyone else.

create type lead_status as enum ('new', 'contacted', 'qualified', 'won', 'lost');

/**
 * `lost_reason` is a free-text note rather than an enum on purpose. We do not
 * yet know how Nigerian SMBs describe a lost deal, and guessing the categories
 * now would force every future answer into a shape invented before any data
 * existed. The enum can come later, once there is something to read.
 */
create table leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,

  -- Attribution, captured at birth. Nullable because a lead can also be
  -- entered by hand (someone who walked in, or messaged the page directly),
  -- and a lead with no ad behind it is still worth tracking — it is just not
  -- evidence about any creative.
  ad_id uuid references ads(id) on delete set null,
  creative_id uuid references creatives(id) on delete set null,
  smart_link_id uuid references smart_links(id) on delete set null,
  click_event_id uuid references click_events(id) on delete set null,

  source text not null check (source in ('meta_form', 'whatsapp', 'smart_link', 'manual')),

  -- A recognition label, NOT contact details. "Ada ••7391" is enough for an
  -- owner to know who this is; it identifies nobody to anybody else.
  label text,

  status lead_status not null default 'new',
  lost_reason text,

  -- Only meaningful when status = 'won'. The constraint below keeps it honest:
  -- a value on a lead that did not close would quietly inflate every report
  -- built on top of this table.
  value_usd_minor bigint check (value_usd_minor is null or value_usd_minor >= 0),

  created_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),

  constraint value_only_when_won
    check (value_usd_minor is null or status = 'won'),
  constraint reason_only_when_lost
    check (lost_reason is null or status = 'lost')
);

create index leads_business_status_idx on leads (business_id, status, created_at desc);
create index leads_creative_idx on leads (creative_id) where creative_id is not null;

/**
 * Every status change, kept forever.
 *
 * Without this the table can only answer "what is this lead now". The questions
 * worth money are "how long did it take to close" and "when did this actually
 * happen" — and a single mutable timestamp cannot answer either, because the
 * last edit overwrites the history. It also means a lead marked won, then
 * corrected to lost, leaves a trail rather than silently rewriting the past.
 */
create table lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_status lead_status,
  to_status lead_status not null,
  note text,
  created_at timestamptz not null default now()
);

create index lead_events_lead_idx on lead_events (lead_id, created_at);

alter table leads enable row level security;
alter table lead_events enable row level security;

create policy "own leads" on leads
  for all using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "own lead events" on lead_events
  for all using (
    lead_id in (
      select l.id from leads l
      join businesses b on b.id = l.business_id
      where b.owner_id = auth.uid()
    )
  )
  with check (
    lead_id in (
      select l.id from leads l
      join businesses b on b.id = l.business_id
      where b.owner_id = auth.uid()
    )
  );

/**
 * Move a lead, and record that it moved.
 *
 * One function rather than an UPDATE from the client, because three things must
 * happen together or not at all: the status changes, the history gains a row,
 * and the value/reason rules are enforced. Done client-side, a dropped second
 * request leaves a lead whose history disagrees with its status, and the
 * history is the part we later use to judge creatives.
 *
 * SECURITY INVOKER, so row-level security applies and a caller can only move
 * their own leads. That is the opposite of the erasure function next door, and
 * for the opposite reason: this is an ordinary thing an owner does many times a
 * week, not a dangerous thing done once.
 */
create or replace function set_lead_status(
  p_lead_id uuid,
  p_status lead_status,
  p_value_usd_minor bigint default null,
  p_note text default null
)
returns leads
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from lead_status;
  v_row leads;
begin
  select status into v_from from leads where id = p_lead_id;
  if v_from is null then
    raise exception 'no such lead';
  end if;

  -- A won lead needs a value. Without one, "cost per won deal" silently treats
  -- the deal as worth nothing, which is worse than refusing.
  if p_status = 'won' and (p_value_usd_minor is null or p_value_usd_minor < 0) then
    raise exception 'a won lead needs its value';
  end if;

  update leads
  set status = p_status,
      status_changed_at = now(),
      value_usd_minor = case when p_status = 'won' then p_value_usd_minor else null end,
      lost_reason = case when p_status = 'lost' then p_note else null end
  where id = p_lead_id
  returning * into v_row;

  insert into lead_events (lead_id, from_status, to_status, note)
  values (p_lead_id, v_from, p_status, p_note);

  return v_row;
end $$;

revoke all on function set_lead_status(uuid, lead_status, bigint, text) from public, anon;
grant execute on function set_lead_status(uuid, lead_status, bigint, text) to authenticated;
