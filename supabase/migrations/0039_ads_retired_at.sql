-- When this ad was stopped, as confirmed by the ad network.
--
-- A separate column rather than a status value, because ads.status already
-- means something else: the launcher writes 'launched' / 'awaiting_payment' /
-- 'error', which record HOW THE LAUNCH WENT. Writing 'PAUSED' into the same
-- column -- which the first version of the retirement code did -- mixes an
-- outcome vocabulary with a state vocabulary, and loses the fact that the ad
-- launched successfully in the first place.
--
-- Null means "as far as we know, still running". Set only after the network
-- confirms the pause, never optimistically: a row that says stopped while the
-- ad is still spending is a lie in the direction that costs the customer.
alter table ads
  add column if not exists retired_at timestamptz;

comment on column ads.retired_at is
  'When the ad network confirmed this ad was paused. Null = still running. Distinct from status, which records the launch outcome.';

create index if not exists ads_live_idx on ads (campaign_id) where retired_at is null;
