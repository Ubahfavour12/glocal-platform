-- 0011: website pixel attribution. The smart link already stamps app_cid on
-- the destination URL; store it on the click so a later purchase (reported by
-- the pixel) can be matched back to the exact ad.
alter table click_events
  add column if not exists app_cid text;

create index if not exists click_events_app_cid_idx on click_events (app_cid);
