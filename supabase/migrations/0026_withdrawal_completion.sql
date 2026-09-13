-- A withdrawal was never finished.
--
-- The refund job does its half correctly: it claims each allocation, sends the
-- money back to the card that paid in, and records the result. Nothing then
-- closes the PARENT withdrawal. `settle_withdrawal` exists and is called by
-- nobody, so a withdrawal sits at 'requested' forever, even after every penny
-- has been returned.
--
-- Three consequences, in ascending order of seriousness:
--
--  1. The customer sees a withdrawal that is permanently "pending" when their
--     money is already back. Merely wrong.
--
--  2. A failed refund leaves the wallet debited and the money not sent. The
--     customer is simply short, and nothing says so.
--
--  3. `withdrawals_one_pending` allows one open request per business. Because
--     the first one never closes, THE CUSTOMER CAN NEVER WITHDRAW AGAIN. Not
--     "until someone looks at it" -- ever. Withdrawals work exactly once per
--     business and are then silently dead.
--
-- This closes the loop in the database rather than in the job, so it holds for
-- any future caller and cannot be skipped by a worker that dies at the wrong
-- moment.

/**
 * Close a withdrawal once none of its refunds are still in flight.
 *
 * Only acts when every allocation has reached a terminal state, so a partially
 * sent withdrawal stays open and the remaining refunds keep their turn.
 *
 * Partial failure is credited back rather than treated as a whole rejection.
 * Some of the money genuinely did reach the customer, so reversing the entire
 * withdrawal would credit them twice for that part. What returns is exactly the
 * amount that could not be sent.
 *
 * Idempotent by the same rule as settle_withdrawal: a withdrawal that is not
 * 'requested' is left alone, so a retried job cannot credit anyone twice.
 */
create or replace function finalise_withdrawal(p_withdrawal_id uuid)
returns withdrawal_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row withdrawals%rowtype;
  v_wallet_id uuid;
  v_open int;
  v_total int;
  v_failed_usd_minor bigint;
  v_reversal_id uuid;
begin
  select * into v_row from withdrawals where id = p_withdrawal_id for update;
  if v_row.id is null or v_row.status <> 'requested' then
    return coalesce(v_row.status, 'requested'::withdrawal_status);
  end if;

  select
    count(*),
    count(*) filter (where status in ('pending', 'sending')),
    coalesce(sum(amount_usd_minor) filter (where status = 'failed'), 0)
  into v_total, v_open, v_failed_usd_minor
  from withdrawal_allocations
  where withdrawal_id = p_withdrawal_id;

  -- No allocations at all means the withdrawal was never funded out; leave it
  -- for a human rather than declaring it paid.
  if v_total = 0 or v_open > 0 then
    return 'requested'::withdrawal_status;
  end if;

  if v_failed_usd_minor > 0 then
    select id into v_wallet_id from wallets where business_id = v_row.business_id for update;
    insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
    values (v_wallet_id, 'adjustment', v_failed_usd_minor,
            'withdrawal shortfall returned: refund could not be sent')
    returning id into v_reversal_id;
  end if;

  update withdrawals
     set status = 'paid',
         settled_at = now(),
         reversal_entry_id = coalesce(v_reversal_id, reversal_entry_id),
         note = coalesce(
           note,
           case when v_failed_usd_minor > 0
                then 'partially refunded; shortfall returned to balance'
                else null end)
   where id = p_withdrawal_id;

  insert into audit_log (business_id, actor, action, detail)
  values (v_row.business_id, 'platform', 'withdrawal_paid',
          jsonb_build_object(
            'withdrawal_id', p_withdrawal_id,
            'usd_minor', v_row.amount_usd_minor,
            'returned_usd_minor', v_failed_usd_minor));

  return 'paid'::withdrawal_status;
end $$;

revoke all on function finalise_withdrawal(uuid) from public, anon, authenticated;
grant execute on function finalise_withdrawal(uuid) to service_role;

/**
 * Recording a refund result now also closes the withdrawal when that was the
 * last one outstanding.
 *
 * Deliberately here rather than in the job: the job is one caller today, and a
 * loop that only closes when someone remembers to call the closing function is
 * the bug this migration exists to fix.
 */
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
declare
  v_withdrawal_id uuid;
begin
  update withdrawal_allocations
     set status = p_status,
         refund_ref = coalesce(p_refund_ref, refund_ref),
         failure_reason = coalesce(p_failure_reason, failure_reason)
   -- Only a claimed row can be resolved, so a stale result cannot resurrect an
   -- allocation that has already been settled another way.
   where id = p_allocation_id and status = 'sending'
   returning withdrawal_id into v_withdrawal_id;

  if v_withdrawal_id is not null then
    perform finalise_withdrawal(v_withdrawal_id);
  end if;
end $$;

revoke all on function record_refund_result(uuid, refund_status, text, text) from public, anon, authenticated;
grant execute on function record_refund_result(uuid, refund_status, text, text) to service_role;

-- Existing withdrawals stuck at 'requested' with nothing in flight are closed
-- by the same rule, so a customer who withdrew before today is not locked out.
do $$
declare r record;
begin
  for r in select id from withdrawals where status = 'requested' loop
    perform finalise_withdrawal(r.id);
  end loop;
end $$;
