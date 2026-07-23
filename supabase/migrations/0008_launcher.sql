-- 0008: morning launcher support (Phase 2.2).
-- Ads created by the launcher hold Meta's own creative id; the local
-- creatives row is optional at launch, so creative_id becomes nullable.
alter table ads
  alter column creative_id drop not null,
  add column if not exists platform_creative_id text;

-- Mark an approved plan as launched so the morning cron never double-launches.
alter table approvals
  add column if not exists launched_at timestamptz;
