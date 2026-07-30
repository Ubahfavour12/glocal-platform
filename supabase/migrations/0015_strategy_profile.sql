-- 0015: Strategy Studio — the deep consultative profile that sharpens the
-- agent's concept writing (positioning, audience, tone, offers, proof). A
-- Growth+ feature; stored as JSON keyed by question id.
alter table businesses
  add column if not exists strategy_profile jsonb;
