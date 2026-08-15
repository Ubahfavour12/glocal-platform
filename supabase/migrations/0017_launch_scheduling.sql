-- 0017: let the customer choose WHEN an approved plan goes live.
--
-- Until now every approved plan launched at the 06:00 UTC cron, which assumes
-- the agent knows the best moment better than the shop owner does. It does not:
-- a wine seller knows Friday evening beats Tuesday morning, and that payday week
-- is different. The agent suggests, the customer decides.
--
-- NULL means "use the default morning run", so existing rows keep working
-- untouched and a customer who never touches this sees no change.
alter table approvals
  add column if not exists scheduled_for timestamptz;

comment on column approvals.scheduled_for is
  'When the customer wants this plan to go live. NULL = the default next-morning launch.';

-- The launcher scans for due plans every run, so this index keeps that cheap as
-- the table grows.
create index if not exists approvals_scheduled_for_idx
  on approvals (scheduled_for)
  where launched_at is null;
