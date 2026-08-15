-- Who the person setting this up is to the business.
--
-- The onboarding design review called this "the one field the required list is
-- genuinely short of", and it is right: nothing in the flow asked whether the
-- person holds the money or just runs the ads. It decides who should receive
-- the evening approval, which is the moment money actually moves.
--
-- Defaults to 'owner' because that is the single-owner case the product is
-- built around, and it keeps every existing row correct.

alter table businesses
  add column if not exists owner_role text not null default 'owner'
    check (owner_role in ('owner', 'staff'));

comment on column businesses.owner_role is
  'owner = holds the money and approves; staff = runs the ads, approval may route elsewhere.';
