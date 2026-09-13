-- Two things the production-readiness review surfaced, both append-only.

-- ============================================================
-- 1. AI GENERATION LOG — EU AI Act evidence
-- ============================================================
--
-- The AI Act's transparency obligations apply to "synthetically generated
-- information": content a model produced that a person then consumes. Every ad
-- creative this product makes is exactly that, and compliance follows the
-- CONSUMER's location, not ours -- we already have GB-registered customers, so
-- we are already inside it.
--
-- Labelling that content is a product decision with a commercial cost and is
-- the founder's to make. This is the half that is not a decision: a record of
-- what was generated, when, by which model, and from what. A regulator asking
-- "what did your system produce last Tuesday" gets an answer instead of a
-- shrug, and the difference between those two is the difference between
-- demonstrating compliance and demonstrating negligence.
--
-- Append-only on purpose. A log that can be edited after the fact proves
-- nothing, which is the entire reason to keep one.

create table if not exists ai_generations (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  creative_id uuid references creatives(id) on delete set null,
  -- What produced it. `model` is the specific model id, not the vendor, because
  -- "fal" is not an answer to "which model wrote this".
  provider text not null,
  model text not null,
  kind text not null check (kind in ('image', 'video', 'text')),
  -- What it was asked for. Stored as a hash plus a short excerpt rather than
  -- the whole prompt: enough to prove what was requested and to match a
  -- complaint to a generation, without turning this table into a second copy
  -- of every customer's business strategy.
  input_sha256 text,
  input_excerpt text,
  output_ref text,
  cost_usd_minor bigint,
  created_at timestamptz not null default now()
);

create index if not exists ai_generations_business_idx
  on ai_generations (business_id, created_at desc);
create index if not exists ai_generations_created_idx
  on ai_generations (created_at desc);

alter table ai_generations enable row level security;

-- A customer may read their own generation history; that is the transparency
-- half of the same obligation. Nobody may write through the API.
create policy "own generations" on ai_generations for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

create or replace function forbid_generation_mutation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ai_generations is append-only';
end $$;

drop trigger if exists ai_generations_no_update on ai_generations;
create trigger ai_generations_no_update before update or delete on ai_generations
  for each row execute function forbid_generation_mutation();

-- ============================================================
-- 2. RATE LIMITS
-- ============================================================
--
-- There was no rate limiting anywhere. The endpoints that matter are the ones
-- that spend money on our side rather than the customer's: concept writing,
-- the studio, and the ask-the-agent route all call Anthropic, and a loop
-- against any of them is a bill rather than an outage.
--
-- In Postgres rather than in memory because the app is serverless: each
-- invocation is a fresh process, so an in-memory counter limits nothing. The
-- round trip is the cost of the limit actually applying.
--
-- Fixed windows rather than a sliding log: cheaper, and the worst case (a
-- burst straddling a boundary getting up to 2x the quota) is acceptable for a
-- limit whose job is to stop runaway loops, not to meter billing precisely.

create table if not exists rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;
-- No policies at all: reachable only through the function below, which runs as
-- definer. A client that could read this table could map our limits.

/**
 * Count one hit against a bucket and say whether it is allowed.
 *
 * Returns the number of hits INCLUDING this one, so the caller compares against
 * its own limit and the policy stays in the application where it is readable.
 *
 * The insert-then-increment is a single statement so two concurrent requests
 * cannot both read 4, both write 5, and both be allowed past a limit of 5.
 */
create or replace function bump_rate_limit(
  p_bucket text,
  p_window_seconds int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  if p_window_seconds <= 0 then
    raise exception 'window must be positive';
  end if;

  -- Floor the clock to the window so every caller in the same period agrees on
  -- which row they are counting against.
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;

  return v_count;
end $$;

revoke all on function bump_rate_limit(text, int) from public, anon, authenticated;
grant execute on function bump_rate_limit(text, int) to service_role;

/** Housekeeping: windows older than a day cannot constrain anything. */
create or replace function prune_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from rate_limits where window_start < now() - interval '1 day';
$$;

revoke all on function prune_rate_limits() from public, anon, authenticated;
grant execute on function prune_rate_limits() to service_role;
