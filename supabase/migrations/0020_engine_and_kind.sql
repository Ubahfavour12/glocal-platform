-- Which engine made this, what it cost, and what a concept is meant to become.
--
-- Both render engines are live from the start and chosen per job. Routing video
-- to Higgsfield and images to fal is a founder decision, not a measurement:
-- nobody has compared their output on this product's own creatives. Recording
-- the engine on every creative is what stops that staying an assumption, since
-- the duel already decides which creative wins on real money. Tag the maker and
-- the existing verdicts become engine evidence for free.
--
-- render_cost_usd_minor is metered rather than estimated. A five-second video
-- costs roughly 10-40x an image, so at the advertised render caps unweighted
-- video would eat about half of a $39 subscription. Guessing that number is how
-- you find out too late.

alter table creatives
  add column if not exists engine text
    check (engine is null or engine in ('fal', 'higgsfield')),
  add column if not exists render_cost_usd_minor bigint;

comment on column creatives.engine is
  'Which render engine produced this, so duel verdicts can be read per engine.';

-- What a concept is meant to become. The first render on an account is always
-- an image; after that the customer picks per render, and a duel may hold two
-- images, two videos, or one of each.
alter table concepts
  add column if not exists kind text not null default 'image'
    check (kind in ('image', 'video'));

create index if not exists creatives_engine_idx
  on creatives (business_id, engine)
  where engine is not null;
