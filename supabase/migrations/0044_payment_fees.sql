-- What the payment processor kept.
--
-- NOT A LEDGER ENTRY, and the distinction is the whole point.
--
-- `ledger_entries` is the record of what a CUSTOMER may spend. markup_fee
-- belongs there because the customer pays it: it is our revenue, debited from
-- their wallet. A processor's fee is the opposite -- it is OUR cost, taken out
-- of what reaches our bank account, and the customer's balance is untouched.
-- Writing it as a wallet debit would have quietly reduced balances and broken
-- the promise printed on the Add Funds screen and in clause 3 of the terms:
-- every dollar goes into your wallet, nothing is taken up front.
--
-- So it sits with the other cost-to-serve records, beside llm_usage, where
-- admin/economics.ts can count it against revenue without ever touching what
-- a customer is owed.
--
-- Until now it was counted nowhere at all. The webhook never read Paystack's
-- `fees` field, and settle.test.ts has a case literally titled "tolerates a
-- small shortfall from FX rounding and PSP fees" -- so the fee was absorbed
-- silently, every charge, forever.
--
-- `psp_ref` is unique, which is what makes this idempotent: the redirect and
-- the webhook both settle the same charge on purpose, and only one of them
-- may record its fee.

create table if not exists payment_fees (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  psp text not null,
  -- Same key record_psp_topup uses, so a double settle records one fee.
  psp_ref text not null unique,
  -- What the customer was charged, in their own currency's minor units.
  charge_local_minor bigint not null,
  -- What the processor kept out of it, same units. Reported by the PSP.
  fee_local_minor bigint not null,
  local_currency text not null,
  -- The buffered rate quoted at checkout, so the USD figure can be re-derived.
  fx_rate numeric not null,
  -- The fee in USD minor units, rounded UP: under-recording a cost is the
  -- error that flatters the margin, which is the mistake this table exists to
  -- stop repeating.
  fee_usd_minor bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists payment_fees_business_idx
  on payment_fees (business_id, created_at desc);

alter table payment_fees enable row level security;

-- A customer may see what it cost to take their money; that is a reasonable
-- thing to be able to audit. Writes are service-role only, from the settle
-- path, because a browser that could insert here could forge our own costs.
create policy "via business" on payment_fees for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
