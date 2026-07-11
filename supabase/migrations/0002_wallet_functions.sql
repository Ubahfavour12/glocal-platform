-- Wallet money-movement — Task #3 (Blueprint §5.1).
-- All mutations happen inside Postgres, atomically, with balance checks that
-- cannot be raced from app code. The ledger stays append-only (0001 trigger).

-- Live balance per wallet, RLS-safe (security_invoker => callers only see
-- balances of wallets their RLS lets them see).
create or replace view wallet_balances
with (security_invoker = true) as
select
  w.id as wallet_id,
  w.business_id,
  coalesce(sum(le.amount_usd_minor), 0)::bigint as balance_usd_minor
from wallets w
left join ledger_entries le on le.wallet_id = w.id
group by w.id, w.business_id;

-- Ensure a wallet exists for a business (idempotent).
create or replace function ensure_wallet(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
begin
  if not exists (
    select 1 from businesses b
    where b.id = p_business_id and b.owner_id = auth.uid()
  ) then
    raise exception 'not your business';
  end if;

  select id into v_wallet_id from wallets where business_id = p_business_id;
  if v_wallet_id is null then
    insert into wallets (business_id) values (p_business_id)
    returning id into v_wallet_id;
  end if;
  return v_wallet_id;
end $$;

-- DEV-ONLY top-up: lets the owner credit small test amounts before the PSPs
-- are connected. Hard caps: $200 per call, $1,000 lifetime per wallet.
-- Replaced by PSP webhooks (which insert with note = psp ref) before launch;
-- a later migration drops this function.
create or replace function record_dev_topup(p_business_id uuid, p_usd_minor bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_dev_total bigint;
  v_entry_id uuid;
begin
  if p_usd_minor is null or p_usd_minor <= 0 or p_usd_minor > 20000 then
    raise exception 'dev top-up must be between 1 and 20000 minor units';
  end if;

  v_wallet_id := ensure_wallet(p_business_id);

  select coalesce(sum(amount_usd_minor), 0) into v_dev_total
  from ledger_entries
  where wallet_id = v_wallet_id and kind = 'topup' and note = 'dev-topup';
  if v_dev_total + p_usd_minor > 100000 then
    raise exception 'dev top-up lifetime cap reached';
  end if;

  insert into ledger_entries (wallet_id, kind, amount_usd_minor, note)
  values (v_wallet_id, 'topup', p_usd_minor, 'dev-topup')
  returning id into v_entry_id;

  insert into audit_log (business_id, actor, action, detail)
  values (p_business_id, 'user', 'dev_topup',
          jsonb_build_object('usd_minor', p_usd_minor, 'entry', v_entry_id));
  return v_entry_id;
end $$;

-- Ad spend + markup, atomically, never letting the balance go negative.
-- Orchestrator-only: revoked from end users below.
create or replace function record_spend(
  p_wallet_id uuid,
  p_spend_usd_minor bigint,
  p_markup_bps int,
  p_campaign_ref uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_fee bigint;
begin
  if p_spend_usd_minor is null or p_spend_usd_minor <= 0 then
    raise exception 'spend must be positive';
  end if;
  if p_markup_bps is null or p_markup_bps < 0 or p_markup_bps > 3000 then
    raise exception 'markup out of range';
  end if;

  v_fee := ceil(p_spend_usd_minor * p_markup_bps / 10000.0)::bigint;

  -- serialize concurrent spends on this wallet
  perform 1 from wallets where id = p_wallet_id for update;

  select coalesce(sum(amount_usd_minor), 0) into v_balance
  from ledger_entries where wallet_id = p_wallet_id;

  if v_balance < p_spend_usd_minor + v_fee then
    raise exception 'insufficient balance: have %, need %',
      v_balance, p_spend_usd_minor + v_fee;
  end if;

  insert into ledger_entries (wallet_id, kind, amount_usd_minor, campaign_ref)
  values (p_wallet_id, 'ad_spend', -p_spend_usd_minor, p_campaign_ref);
  insert into ledger_entries (wallet_id, kind, amount_usd_minor, campaign_ref)
  values (p_wallet_id, 'markup_fee', -v_fee, p_campaign_ref);
end $$;

-- Permissions: owners may ensure wallets and make capped dev top-ups;
-- spending money is reserved for the orchestrator (service role).
revoke all on function ensure_wallet(uuid) from public, anon;
grant execute on function ensure_wallet(uuid) to authenticated;
revoke all on function record_dev_topup(uuid, bigint) from public, anon;
grant execute on function record_dev_topup(uuid, bigint) to authenticated;
revoke all on function record_spend(uuid, bigint, int, uuid) from public, anon, authenticated;
grant execute on function record_spend(uuid, bigint, int, uuid) to service_role;
