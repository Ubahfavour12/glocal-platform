-- Core schema — TRD §2 "Data Model"
-- All money columns are integer minor units (USD cents unless suffixed _local).

create extension if not exists "uuid-ossp";

-- ---------- enums ----------
create type goal_type as enum ('sales', 'leads', 'whatsapp', 'visits');
create type ledger_kind as enum ('topup', 'ad_spend', 'markup_fee', 'subscription', 'refund', 'adjustment');
create type ad_platform as enum ('meta', 'tiktok', 'google');
create type provisioning_state as enum ('pending', 'active', 'failed', 'archived');
create type creative_state as enum ('concept', 'rendering', 'rendered', 'gateway_blocked', 'approved', 'live', 'paused', 'retired');
create type scan_result as enum ('pass', 'block');
create type rejection_tier as enum ('soft', 'hard');
create type persona_mode as enum ('conservative', 'smart', 'aggressive');
create type verdict_status as enum ('pending', 'decided');
create type approval_status as enum ('awaiting', 'approved', 'swapped', 'regenerating', 'expired');
create type conversion_kind as enum ('whatsapp_open', 'call', 'site_session', 'verified_order');

-- ---------- identity ----------
create table businesses (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  category_blocked boolean not null default false,
  goal goal_type not null default 'whatsapp',
  service_geo jsonb not null default '{}'::jsonb, -- macro geo only (Creative-Led Targeting)
  currency text not null default 'USD',
  persona persona_mode not null default 'smart',
  full_auto boolean not null default false,       -- approval gate on by default
  daily_budget_usd_minor bigint not null default 1000 check (daily_budget_usd_minor >= 1000), -- $10/day floor
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  tier text not null default 'starter',           -- starter | growth | scale
  renders_per_day int not null default 2,
  socials_limit int not null default 3,
  platforms ad_platform[] not null default '{meta}',
  spend_markup_bps int not null default 1500,     -- 15% = 1500 basis points
  purchase_channel text not null default 'web',   -- web | ios_iap
  active boolean not null default true,
  renews_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- money (PSP-held; we keep the ledger only) ----------
create table wallets (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  psp text not null default 'stripe',             -- stripe | flutterwave
  psp_ref text,
  created_at timestamptz not null default now()
);

create table ledger_entries (
  id uuid primary key default uuid_generate_v4(),
  wallet_id uuid not null references wallets(id) on delete restrict,
  kind ledger_kind not null,
  amount_usd_minor bigint not null,               -- signed; credits positive
  amount_local_minor bigint,
  local_currency text,
  fx_rate numeric(18, 8),                          -- local per USD at effective (buffered) rate
  fx_fetched_at timestamptz,
  psp_ref text,
  campaign_ref uuid,
  note text,
  created_at timestamptz not null default now()
);
-- ledger is append-only: no update/delete grants; enforced additionally by trigger
create or replace function forbid_ledger_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only';
end $$;
create trigger ledger_no_update before update or delete on ledger_entries
  for each row execute function forbid_ledger_mutation();

-- ---------- ad infrastructure (child account per client) ----------
create table ad_accounts (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  platform ad_platform not null,
  platform_account_id text,
  platform_page_id text,                          -- auto-created page carrying the client's brand
  state provisioning_state not null default 'pending',
  strike_count int not null default 0,
  quarantined boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, platform)
);

-- ---------- creative pipeline ----------
create table concepts (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  rank int not null,                              -- 1..50 by predicted virality
  hook text not null,
  storyboard jsonb not null,
  copy_angle text not null,
  cta text not null,
  source_pattern text,                            -- reverse-engineered origin
  rendered boolean not null default false,
  created_at timestamptz not null default now()
);

create table creatives (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  concept_id uuid references concepts(id),
  state creative_state not null default 'concept',
  media_url text,
  render_job_ref text,
  ad_copy text,
  gateway_scan_id uuid,
  created_at timestamptz not null default now()
);

create table compliance_scans (
  id uuid primary key default uuid_generate_v4(),
  creative_id uuid not null references creatives(id) on delete cascade,
  result scan_result not null,
  risk_score numeric(5, 2) not null,
  issues jsonb not null default '[]'::jsonb,
  model_version text not null,
  created_at timestamptz not null default now()
);

-- ---------- campaigns ----------
create table campaigns (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id),
  platform ad_platform not null,
  platform_campaign_id text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table ads (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  creative_id uuid not null references creatives(id),
  platform_ad_id text,
  platform_adset_id text,
  budget_usd_minor bigint not null default 0,
  is_champion boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- ---------- testing & learning ----------
create table ab_tests (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  test_date date not null,
  champion_ad_id uuid references ads(id),
  challenger_ad_ids uuid[] not null default '{}',
  status verdict_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (business_id, test_date)
);

create table verdicts (
  id uuid primary key default uuid_generate_v4(),
  ab_test_id uuid not null references ab_tests(id) on delete cascade,
  winner_ad_id uuid references ads(id),
  metric_used text not null,                      -- roas | cpci | engagement
  evidence jsonb not null,
  decided_at timestamptz not null default now()
);

create table journal_entries (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  entry_type text not null,                       -- verdict | rejection | mutation | scaling | note
  content jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- rejections & trust ----------
create table rejections (
  id uuid primary key default uuid_generate_v4(),
  ad_id uuid not null references ads(id) on delete cascade,
  platform ad_platform not null,
  reason_code text,
  tier rejection_tier not null,
  action_taken text not null,                     -- auto_fixed | quarantined
  created_at timestamptz not null default now()
);

-- ---------- zero-code tracking ----------
create table smart_links (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null unique,
  destination_kind text not null,                 -- whatsapp | call | url
  destination text not null,
  ad_id uuid references ads(id),
  created_at timestamptz not null default now()
);

create table click_events (
  id uuid primary key default uuid_generate_v4(),
  smart_link_id uuid not null references smart_links(id) on delete cascade,
  platform_click_id text,
  user_agent text,
  geo text,
  created_at timestamptz not null default now()
);

create table conversions (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  click_event_id uuid references click_events(id),
  kind conversion_kind not null,
  order_ref text,
  value_usd_minor bigint,
  created_at timestamptz not null default now()
);

-- ---------- connections ----------
create table store_connections (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null,                         -- shopify | wix | woocommerce
  status text not null default 'pending',
  webhook_secret text,
  created_at timestamptz not null default now()
);

create table social_connections (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  network text not null,
  metricool_brand_ref text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- ---------- approvals & audit ----------
create table approvals (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan_date date not null,
  payload jsonb not null,                         -- the evening plan card
  status approval_status not null default 'awaiting',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, plan_date)
);

create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses(id) on delete set null,
  actor text not null,                            -- agent step or user
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table businesses enable row level security;
alter table subscriptions enable row level security;
alter table wallets enable row level security;
alter table ledger_entries enable row level security;
alter table ad_accounts enable row level security;
alter table concepts enable row level security;
alter table creatives enable row level security;
alter table compliance_scans enable row level security;
alter table campaigns enable row level security;
alter table ads enable row level security;
alter table ab_tests enable row level security;
alter table verdicts enable row level security;
alter table journal_entries enable row level security;
alter table rejections enable row level security;
alter table smart_links enable row level security;
alter table click_events enable row level security;
alter table conversions enable row level security;
alter table store_connections enable row level security;
alter table social_connections enable row level security;
alter table approvals enable row level security;
alter table audit_log enable row level security;

create policy "own business" on businesses for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ownership flows through business_id on every customer-facing table
create policy "via business" on subscriptions for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on wallets for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via wallet" on ledger_entries for select
  using (wallet_id in (select w.id from wallets w join businesses b on b.id = w.business_id where b.owner_id = auth.uid()));
create policy "via business" on ad_accounts for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on concepts for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on creatives for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via creative" on compliance_scans for select
  using (creative_id in (select c.id from creatives c join businesses b on b.id = c.business_id where b.owner_id = auth.uid()));
create policy "via business" on campaigns for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via campaign" on ads for select
  using (campaign_id in (select c.id from campaigns c join businesses b on b.id = c.business_id where b.owner_id = auth.uid()));
create policy "via business" on ab_tests for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via test" on verdicts for select
  using (ab_test_id in (select t.id from ab_tests t join businesses b on b.id = t.business_id where b.owner_id = auth.uid()));
create policy "via business" on journal_entries for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via ad" on rejections for select
  using (ad_id in (select a.id from ads a join campaigns c on c.id = a.campaign_id join businesses b on b.id = c.business_id where b.owner_id = auth.uid()));
create policy "via business" on smart_links for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via link" on click_events for select
  using (smart_link_id in (select s.id from smart_links s join businesses b on b.id = s.business_id where b.owner_id = auth.uid()));
create policy "via business" on conversions for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on store_connections for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on social_connections for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on approvals for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "approval respond" on approvals for update
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via business" on audit_log for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

-- writes on pipeline tables happen only through service-role orchestrator jobs
