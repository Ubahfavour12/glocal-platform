-- 0007: the business's connection door (Phase 2.2 launcher prerequisite).
-- tracking/modes.ts defined the three doors; this stores the customer's
-- choice so minted smart links have a real destination:
--   whatsapp -> wa.me digits · website/store -> https url
alter table businesses
  add column if not exists connection_mode text not null default 'whatsapp'
    check (connection_mode in ('store', 'website', 'whatsapp')),
  add column if not exists destination text;

comment on column businesses.destination is
  'whatsapp: normalised wa.me digits; website/store: https url';
