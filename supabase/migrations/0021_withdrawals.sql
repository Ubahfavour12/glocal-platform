-- Withdrawals: paying a customer back their unspent balance.
--
-- A wallet holds money the customer has already handed over, so being able to
-- ask for it back is not a feature, it is the other half of taking it. Only
-- UNSPENT balance is withdrawable: delivered ad spend is a service already
-- rendered and is never refundable.
--
-- The money moves the moment the withdrawal is REQUESTED, not when it is paid
-- out. That ordering is deliberate. If the debit waited for payout, the ads
-- could keep spending the same dollars in the meantime and the customer would
-- be promised money the wallet no longer had. Debiting on request reserves it.
-- A rejected or cancelled request is compensated with a matching credit, never
-- by deleting the debit: ledger_entries is append-only and stays that way.

create type withdrawal_status as enum ('requested', 'paid', 'rejected', 'cancelled');

create table withdrawals (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete restrict,
  amount_usd_minor bigint not null check (amount_usd_minor > 0),
  status withdrawal_status not null default 'requested',
  -- Where the money goes. The customer's own bank details, readable only by
  -- them (RLS below) and the service role that performs the payout.
  destination jsonb not null,
  -- The reserving debit, so the money movement is always traceable both ways.
  ledger_entry_id uuid not null references ledger_entries(id) on delete restrict,
  -- The compensating credit, once a request is rejected or cancelled.
  reversal_entry_id uuid references ledger_entries(id) on delete restrict,
  payout_ref text,
  note text,
  requested_at timestamptz not null default now(),
  settled_at timestamptz
);

create index withdrawals_business_idx on withdrawals (business_id, requested_at desc);

-- At most one open request per business. Enforced by the database rather than
-- by a check in the application, because two taps of the button race each
-- other and only the index is authoritative under concurrency.
create unique index withdrawals_one_pending
  on withdrawals (business_id)
  where status = 'requested';

alter table withdrawals enable row level security;

create policy "via business" on withdrawals for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

-- No insert/update policy: everything goes through the functions below, so the
-- balance check and the debit can never be separated.

/**
 * Request a withdrawal of unspent balance.
 *
 * Locks the wallet row first. Without the lock, two concurrent requests would
 * both read the same balance, both pass the check, and together overdraw the
 * wallet -- the classic check-then-act race, and the reason this is one
 * function in the database rather than a read and a write in the API route.
 */
create or replace function request_withdrawal(
  p_business_id uuid,
  p_amount_usd_minor bigint,
  p_destination jsonb
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
begin
  if p_amount_usd_minor is null or p_amount_usd_minor <= 0 then
    raise exception 'withdrawal amount must be positive';
  end if;
  if p_destination is null or p_destination = '{}'::jsonb then
    raise exception 'withdrawal destination required';
  end if;

  -- Lock the wallet so the balance cannot move under us.
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

  insert into withdrawals (business_id, amount_usd_minor, destination, ledger_entry_id)
  values (p_business_id, p_amount_usd_minor, p_destination, v_entry_id)
  returning id into v_withdrawal_id;

  insert into audit_log (business_id, actor, action, detail)
  values (p_business_id, 'customer', 'withdrawal_requested',
          jsonb_build_object('withdrawal_id', v_withdrawal_id,
                             'usd_minor', p_amount_usd_minor));

  return v_withdrawal_id;
end $$;

revoke all on function request_withdrawal(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function request_withdrawal(uuid, bigint, jsonb) to service_role;

/**
 * Settle an open withdrawal: paid, rejected, or cancelled.
 *
 * Rejection and cancellation put the money back with a compensating credit
 * rather than by removing the debit, so the ledger still reads as a true
 * history of what happened rather than of what we wish had happened.
 * Idempotent: settling an already-settled withdrawal is a no-op, so a retried
 * payout job cannot credit the customer twice.
 */
create or replace function settle_withdrawal(
  p_withdrawal_id uuid,
  p_status withdrawal_status,
  p_payout_ref text default null,
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
  -- Already settled: report what it is, change nothing.
  if v_row.status <> 'requested' then
    return v_row.status;
  end if;

  if p_status in ('rejected', 'cancelled') then
    select id into v_wallet_id from wallets where business_id = v_row.business_id for update;
    insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
    values (v_wallet_id, 'adjustment', v_row.amount_usd_minor,
            'withdrawal ' || p_status::text)
    returning id into v_reversal_id;
  end if;

  update withdrawals
     set status = p_status,
         payout_ref = coalesce(p_payout_ref, payout_ref),
         note = coalesce(p_note, note),
         reversal_entry_id = coalesce(v_reversal_id, reversal_entry_id),
         settled_at = now()
   where id = p_withdrawal_id;

  insert into audit_log (business_id, actor, action, detail)
  values (v_row.business_id, 'platform', 'withdrawal_' || p_status::text,
          jsonb_build_object('withdrawal_id', p_withdrawal_id,
                             'usd_minor', v_row.amount_usd_minor,
                             'payout_ref', p_payout_ref));

  return p_status;
end $$;

revoke all on function settle_withdrawal(uuid, withdrawal_status, text, text) from public, anon, authenticated;
grant execute on function settle_withdrawal(uuid, withdrawal_status, text, text) to service_role;
