-- Withdrawals: returning a customer's unspent balance.
--
-- Money goes back the way it came, to the card or account that paid it. That is
-- the decision this file encodes, and it is a safety decision before it is a
-- convenience one:
--
--   * Nothing to steal. We never ask for, store, or transmit bank details, so
--     there is no account number in this database to leak and none to mistype.
--   * An account takeover cannot extract money. Someone who gets into a
--     customer's email can request a withdrawal, but it can only go back to the
--     card that funded the wallet, which is not theirs. If the destination were
--     a bank field they controlled, taking over the account would BE the theft.
--   * It is the reversal the card networks and PSPs already understand, so it
--     is traceable end to end and disputes resolve against a real transaction
--     rather than an outbound transfer we made up.
--
-- A withdrawal is therefore not one payment. It is a set of refunds against the
-- specific top-ups that funded the balance, allocated newest-first, each one
-- refunded on the rail that took it. That is what withdrawal_allocations is.
--
-- The money leaves spendable balance when the withdrawal is REQUESTED, not when
-- the refunds clear. If the debit waited, the ads would keep spending the same
-- dollars while refunds were in flight and the customer would be promised money
-- the wallet no longer had. A rejected or cancelled request is compensated with
-- a matching credit, never by deleting the debit: ledger_entries is append-only
-- and stays a record of what happened.

create type withdrawal_status as enum ('requested', 'paid', 'rejected', 'cancelled');
-- 'sending' is the state that stops a refund going out twice. An allocation is
-- moved into it BEFORE the PSP is called, so a crashed or retried worker finds
-- it already claimed rather than paying the customer a second time.
create type refund_status as enum ('pending', 'sending', 'refunded', 'failed');

create table withdrawals (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete restrict,
  amount_usd_minor bigint not null check (amount_usd_minor > 0),
  status withdrawal_status not null default 'requested',
  -- The reserving debit and, once reversed, the compensating credit.
  ledger_entry_id uuid not null references ledger_entries(id) on delete restrict,
  reversal_entry_id uuid references ledger_entries(id) on delete restrict,
  note text,
  requested_at timestamptz not null default now(),
  settled_at timestamptz
);

-- Which original payments this withdrawal gives back, and how much of each.
create table withdrawal_allocations (
  id uuid primary key default uuid_generate_v4(),
  withdrawal_id uuid not null references withdrawals(id) on delete cascade,
  -- The PSP's own reference for the top-up being refunded ("flw-123", "ps-456").
  psp_ref text not null,
  amount_usd_minor bigint not null check (amount_usd_minor > 0),
  status refund_status not null default 'pending',
  -- The PSP's reference for the refund itself, once it exists.
  refund_ref text,
  failure_reason text,
  attempted_at timestamptz,
  created_at timestamptz not null default now()
);

create index withdrawals_business_idx on withdrawals (business_id, requested_at desc);
create index withdrawal_allocations_withdrawal_idx on withdrawal_allocations (withdrawal_id);
create index withdrawal_allocations_ref_idx on withdrawal_allocations (psp_ref);

-- At most one open request per business. Enforced by the database rather than
-- by a check in the application, because two taps of the button race each
-- other and only the index is authoritative under concurrency.
create unique index withdrawals_one_pending
  on withdrawals (business_id)
  where status = 'requested';

alter table withdrawals enable row level security;
alter table withdrawal_allocations enable row level security;

create policy "via business" on withdrawals for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "via withdrawal" on withdrawal_allocations for select
  using (withdrawal_id in (
    select w.id from withdrawals w
    join businesses b on b.id = w.business_id
    where b.owner_id = auth.uid()
  ));

-- No insert/update policy: everything goes through the functions below, so the
-- balance check and the debit can never be separated.

/**
 * How much of each past top-up is still refundable.
 *
 * A top-up can back more than one withdrawal over time, so what matters is what
 * is left of it, not its original size. Newest first: recent payments are the
 * ones still inside a PSP's refund window, and refunding those first keeps the
 * most money on the automatic path.
 */
create or replace view refundable_topups
with (security_invoker = true) as
select
  b.id as business_id,
  le.psp_ref,
  le.created_at,
  le.amount_usd_minor
    - coalesce((
        select sum(a.amount_usd_minor) from withdrawal_allocations a
        where a.psp_ref = le.psp_ref and a.status <> 'failed'
      ), 0) as remaining_usd_minor
from ledger_entries le
join wallets w on w.id = le.wallet_id
join businesses b on b.id = w.business_id
where le.kind = 'topup' and le.psp_ref is not null;

/**
 * Request a withdrawal of unspent balance, back to the payments that funded it.
 *
 * Locks the wallet row first. Without the lock, two concurrent requests would
 * both read the same balance, both pass the check, and together overdraw the
 * wallet -- the classic check-then-act race, and the reason this is one
 * function in the database rather than a read and a write in the API route.
 */
create or replace function request_withdrawal(
  p_business_id uuid,
  p_amount_usd_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_balance bigint;
  v_entry_id uuid;
  v_withdrawal_id uuid;
  v_left bigint;
  v_take bigint;
  v_row record;
begin
  if p_amount_usd_minor is null or p_amount_usd_minor <= 0 then
    raise exception 'withdrawal amount must be positive';
  end if;

  select id into v_wallet_id from wallets where business_id = p_business_id for update;
  if v_wallet_id is null then
    raise exception 'no wallet for business';
  end if;

  select coalesce(sum(amount_usd_minor), 0)::bigint into v_balance
  from ledger_entries where wallet_id = v_wallet_id;

  if p_amount_usd_minor > v_balance then
    raise exception 'amount exceeds withdrawable balance';
  end if;

  -- Reserve the money now. Negative: this is a debit.
  insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
  values (v_wallet_id, 'refund', -p_amount_usd_minor, 'withdrawal requested')
  returning id into v_entry_id;

  insert into withdrawals (business_id, amount_usd_minor, ledger_entry_id)
  values (p_business_id, p_amount_usd_minor, v_entry_id)
  returning id into v_withdrawal_id;

  -- Spread the amount across the payments that funded it, newest first.
  v_left := p_amount_usd_minor;
  for v_row in
    select psp_ref, remaining_usd_minor from refundable_topups
     where business_id = p_business_id and remaining_usd_minor > 0
     order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_row.remaining_usd_minor);
    insert into withdrawal_allocations (withdrawal_id, psp_ref, amount_usd_minor)
    values (v_withdrawal_id, v_row.psp_ref, v_take);
    v_left := v_left - v_take;
  end loop;

  -- Should be unreachable: balance can never exceed unrefunded top-ups. If it
  -- somehow does, refuse loudly rather than promise money with no source.
  if v_left > 0 then
    raise exception 'only % of % can be returned to its original payment',
      p_amount_usd_minor - v_left, p_amount_usd_minor;
  end if;

  insert into audit_log (business_id, actor, action, detail)
  values (p_business_id, 'customer', 'withdrawal_requested',
          jsonb_build_object('withdrawal_id', v_withdrawal_id,
                             'usd_minor', p_amount_usd_minor));

  return v_withdrawal_id;
end $$;

revoke all on function request_withdrawal(uuid, bigint) from public, anon, authenticated;
grant execute on function request_withdrawal(uuid, bigint) to service_role;

/**
 * Settle an open withdrawal: paid, rejected, or cancelled.
 *
 * Rejection and cancellation put the money back with a compensating credit
 * rather than by removing the debit, so the ledger still reads as a true
 * history of what happened rather than of what we wish had happened. The
 * allocations are marked failed at the same time, which releases their claim on
 * those top-ups so a later withdrawal can use them again.
 *
 * Idempotent: settling an already-settled withdrawal is a no-op, so a retried
 * payout job cannot credit the customer twice.
 */
create or replace function settle_withdrawal(
  p_withdrawal_id uuid,
  p_status withdrawal_status,
  p_note text default null
)
returns withdrawal_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row withdrawals%rowtype;
  v_wallet_id uuid;
  v_reversal_id uuid;
begin
  if p_status not in ('paid', 'rejected', 'cancelled') then
    raise exception 'settle_withdrawal cannot set status %', p_status;
  end if;

  select * into v_row from withdrawals where id = p_withdrawal_id for update;
  if v_row.id is null then
    raise exception 'withdrawal not found';
  end if;
  if v_row.status <> 'requested' then
    return v_row.status;
  end if;

  if p_status in ('rejected', 'cancelled') then
    select id into v_wallet_id from wallets where business_id = v_row.business_id for update;
    insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
    values (v_wallet_id, 'adjustment', v_row.amount_usd_minor,
            'withdrawal ' || p_status::text)
    returning id into v_reversal_id;

    update withdrawal_allocations
       set status = 'failed',
           failure_reason = coalesce(failure_reason, 'withdrawal ' || p_status::text)
     where withdrawal_id = p_withdrawal_id and status = 'pending';
  end if;

  update withdrawals
     set status = p_status,
         note = coalesce(p_note, note),
         reversal_entry_id = coalesce(v_reversal_id, reversal_entry_id),
         settled_at = now()
   where id = p_withdrawal_id;

  insert into audit_log (business_id, actor, action, detail)
  values (v_row.business_id, 'platform', 'withdrawal_' || p_status::text,
          jsonb_build_object('withdrawal_id', p_withdrawal_id,
                             'usd_minor', v_row.amount_usd_minor));

  return p_status;
end $$;

revoke all on function settle_withdrawal(uuid, withdrawal_status, text) from public, anon, authenticated;
grant execute on function settle_withdrawal(uuid, withdrawal_status, text) to service_role;

/**
 * Claim the next refund to send, atomically.
 *
 * Moves one allocation from 'pending' to 'sending' and hands it back. Claiming
 * BEFORE the PSP call is the whole point: a worker that crashes mid-refund, or
 * a cron that overlaps itself, finds the row already claimed instead of
 * refunding the customer twice. SKIP LOCKED means two workers running at once
 * take different rows rather than blocking or colliding.
 *
 * A row stuck in 'sending' -- claimed, then the process died before recording a
 * result -- is deliberately NOT retried automatically. Nobody can tell from
 * here whether the PSP received that call, and paying a refund twice is worse
 * than a refund that waits for a person to look. It shows up as a 'sending' row
 * with an attempted_at, which is exactly what an admin console should surface.
 */
create or replace function claim_refund_allocation()
returns table (
  allocation_id uuid,
  psp_ref text,
  amount_usd_minor bigint,
  fx_rate numeric,
  local_currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update withdrawal_allocations a
     set status = 'sending', attempted_at = now()
   where a.id = (
     select inner_a.id
       from withdrawal_allocations inner_a
       join withdrawals w on w.id = inner_a.withdrawal_id
      where inner_a.status = 'pending'
        and w.status = 'requested'
      order by inner_a.created_at
      limit 1
      for update skip locked
   )
  returning a.id into v_id;

  if v_id is null then
    return;
  end if;

  -- The rate the customer actually paid at, carried on the original top-up.
  -- A refund converts back at THAT rate, not today's: they handed over a
  -- specific number of naira and that is the number they get back, rather than
  -- whatever the market has done since.
  return query
  select a.id, a.psp_ref, a.amount_usd_minor, le.fx_rate, le.local_currency
    from withdrawal_allocations a
    join ledger_entries le on le.psp_ref = a.psp_ref and le.kind = 'topup'
   where a.id = v_id;
end $$;

revoke all on function claim_refund_allocation() from public, anon, authenticated;
grant execute on function claim_refund_allocation() to service_role;

/** Record the outcome of one allocation's refund on its rail. */
create or replace function record_refund_result(
  p_allocation_id uuid,
  p_status refund_status,
  p_refund_ref text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update withdrawal_allocations
     set status = p_status,
         refund_ref = coalesce(p_refund_ref, refund_ref),
         failure_reason = coalesce(p_failure_reason, failure_reason)
   -- Only a claimed row can be resolved, so a stale result cannot resurrect an
   -- allocation that has already been settled another way.
   where id = p_allocation_id and status = 'sending';
end $$;

revoke all on function record_refund_result(uuid, refund_status, text, text) from public, anon, authenticated;
grant execute on function record_refund_result(uuid, refund_status, text, text) to service_role;
