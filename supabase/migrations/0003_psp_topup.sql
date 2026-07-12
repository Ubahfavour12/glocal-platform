-- PSP-backed top-ups — Task #3 completion (Blueprint §5.1).
-- Called ONLY by the orchestrator/service role after verifying the payment
-- with the PSP's API. Idempotent on psp_ref: replayed webhooks or repeated
-- redirect confirmations can never credit twice.

create or replace function record_psp_topup(
  p_business_id uuid,
  p_usd_minor bigint,
  p_local_minor bigint,
  p_local_currency text,
  p_fx_rate numeric,
  p_psp_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_existing uuid;
  v_entry_id uuid;
begin
  if p_usd_minor is null or p_usd_minor <= 0 then
    raise exception 'usd amount must be positive';
  end if;
  if p_psp_ref is null or length(p_psp_ref) < 4 then
    raise exception 'psp reference required';
  end if;

  -- idempotency: same PSP reference credits exactly once, ever
  select id into v_existing from ledger_entries
  where psp_ref = p_psp_ref and kind = 'topup';
  if v_existing is not null then
    return v_existing;
  end if;

  select id into v_wallet_id from wallets where business_id = p_business_id;
  if v_wallet_id is null then
    insert into wallets (business_id, psp) values (p_business_id, 'flutterwave')
    returning id into v_wallet_id;
  end if;

  insert into ledger_entries
    (wallet_id, kind, amount_usd_minor, amount_local_minor, local_currency, fx_rate, psp_ref, note)
  values
    (v_wallet_id, 'topup', p_usd_minor, p_local_minor, p_local_currency, p_fx_rate, p_psp_ref, 'flutterwave')
  returning id into v_entry_id;

  insert into audit_log (business_id, actor, action, detail)
  values (p_business_id, 'psp:flutterwave', 'topup_credited',
          jsonb_build_object('usd_minor', p_usd_minor, 'local_minor', p_local_minor,
                             'currency', p_local_currency, 'psp_ref', p_psp_ref));
  return v_entry_id;
end $$;

revoke all on function record_psp_topup(uuid, bigint, bigint, text, numeric, text) from public, anon, authenticated;
grant execute on function record_psp_topup(uuid, bigint, bigint, text, numeric, text) to service_role;
