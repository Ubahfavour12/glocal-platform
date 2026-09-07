-- Ad budget holds, part 2 of 2.
--
-- Money promised to today's ads was still showing as spendable balance. The
-- customer saw one number, the agent had already committed part of it, and the
-- gap only closed hours later when delivered spend was reported. That gap is
-- pure confusion: it invites someone to withdraw or budget money that is
-- already spoken for.
--
-- So the day's budget leaves the balance the moment the plan launches, and
-- comes back when the day's real spend is known. A hold is not a charge. It is
-- the same dollars, moved out of "spendable" and into "already promised", and
-- every hold is released -- either because the real ad_spend replaced it, or
-- because the day it belonged to has passed.

create table budget_holds (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete restrict,
  plan_date date not null,
  amount_usd_minor bigint not null check (amount_usd_minor > 0),
  -- The reserving debit and, once released, the compensating credit.
  ledger_entry_id uuid not null references ledger_entries(id) on delete restrict,
  release_entry_id uuid references ledger_entries(id) on delete restrict,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

-- One hold per business per day. A launch job that runs twice, or retries after
-- a partial failure, must not hold the budget twice.
create unique index budget_holds_one_per_day on budget_holds (business_id, plan_date);
create index budget_holds_open_idx on budget_holds (business_id) where released_at is null;

alter table budget_holds enable row level security;

create policy "via business" on budget_holds for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

/**
 * Hold a day's ad budget out of the spendable balance.
 *
 * Holds at most the available balance. A budget larger than the wallet is a
 * real situation -- the ads simply stop when the money runs out -- and
 * refusing outright would block a launch that can legitimately run for part of
 * the day. The amount actually held is returned so the caller can say so.
 *
 * Returns 0 when there is nothing to hold. Idempotent per business per day.
 */
create or replace function place_budget_hold(
  p_business_id uuid,
  p_plan_date date,
  p_amount_usd_minor bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_balance bigint;
  v_hold bigint;
  v_entry_id uuid;
begin
  if p_amount_usd_minor is null or p_amount_usd_minor <= 0 then
    raise exception 'hold amount must be positive';
  end if;

  -- Already held for this day: report it and change nothing.
  select amount_usd_minor into v_hold from budget_holds
   where business_id = p_business_id and plan_date = p_plan_date;
  if v_hold is not null then
    return v_hold;
  end if;

  select id into v_wallet_id from wallets where business_id = p_business_id for update;
  if v_wallet_id is null then
    return 0;
  end if;

  select coalesce(sum(amount_usd_minor), 0)::bigint into v_balance
    from ledger_entries where wallet_id = v_wallet_id;

  v_hold := least(p_amount_usd_minor, greatest(v_balance, 0));
  if v_hold <= 0 then
    return 0;
  end if;

  insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
  values (v_wallet_id, 'budget_hold', -v_hold, 'held for ' || p_plan_date::text || ' ad budget')
  returning id into v_entry_id;

  insert into budget_holds (business_id, plan_date, amount_usd_minor, ledger_entry_id)
  values (p_business_id, p_plan_date, v_hold, v_entry_id);

  insert into audit_log (business_id, actor, action, detail)
  values (p_business_id, 'job:launch', 'budget_held',
          jsonb_build_object('plan_date', p_plan_date, 'usd_minor', v_hold,
                             'requested_usd_minor', p_amount_usd_minor));

  return v_hold;
end $$;

revoke all on function place_budget_hold(uuid, date, bigint) from public, anon, authenticated;
grant execute on function place_budget_hold(uuid, date, bigint) to service_role;

/**
 * Release a held budget back into spendable balance.
 *
 * A compensating credit, never a deletion: ledger_entries is append-only, and
 * the pair reads as what actually happened -- money set aside, money returned.
 * Idempotent, so a retried release cannot credit twice.
 */
create or replace function release_budget_hold(
  p_business_id uuid,
  p_plan_date date
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row budget_holds%rowtype;
  v_wallet_id uuid;
  v_entry_id uuid;
begin
  select * into v_row from budget_holds
   where business_id = p_business_id and plan_date = p_plan_date
   for update;
  if v_row.id is null or v_row.released_at is not null then
    return 0;
  end if;

  select id into v_wallet_id from wallets where business_id = p_business_id for update;

  insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
  values (v_wallet_id, 'budget_hold', v_row.amount_usd_minor,
          'released ' || p_plan_date::text || ' ad budget')
  returning id into v_entry_id;

  update budget_holds
     set released_at = now(), release_entry_id = v_entry_id
   where id = v_row.id;

  insert into audit_log (business_id, actor, action, detail)
  values (p_business_id, 'job:launch', 'budget_hold_released',
          jsonb_build_object('plan_date', p_plan_date, 'usd_minor', v_row.amount_usd_minor));

  return v_row.amount_usd_minor;
end $$;

revoke all on function release_budget_hold(uuid, date) from public, anon, authenticated;
grant execute on function release_budget_hold(uuid, date) to service_role;

/**
 * Release every hold for a day that has passed.
 *
 * A hold belongs to one day. Without this, a hold placed on a day whose spend
 * never got reported would sit against the balance forever, and the customer
 * would be short money nobody ever spent. Run at the start of each launch
 * cycle, so yesterday's promise is returned before today's is made.
 */
create or replace function release_stale_budget_holds(p_before_date date)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_total bigint := 0;
begin
  for v_row in
    select business_id, plan_date from budget_holds
     where released_at is null and plan_date < p_before_date
  loop
    v_total := v_total + release_budget_hold(v_row.business_id, v_row.plan_date);
  end loop;
  return v_total;
end $$;

revoke all on function release_stale_budget_holds(date) from public, anon, authenticated;
grant execute on function release_stale_budget_holds(date) to service_role;
