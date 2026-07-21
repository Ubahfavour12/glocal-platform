-- 0005: order detail on conversions — multi-item sales + preference learning.
-- A conversion is one whole ORDER, not one unit: value_usd_minor is the full
-- order total, quantity is total units, items lists what was actually bought
-- (name + qty + unit price when known). Product preference is derived from
-- items across conversions, never guessed from the ad alone.

alter table conversions
  add column if not exists quantity int check (quantity is null or quantity > 0),
  add column if not exists items jsonb,
  add column if not exists source text not null default 'manual';
  -- source: manual (mark-as-sold) | pixel | store | platform

comment on column conversions.items is
  'array of {name, qty, unit_value_usd_minor?} — what the buyer actually bought';
