-- An invoice for every payment a customer makes.
--
-- What existed: a ledger (authoritative, reconciled nightly) and a receipt
-- EMAIL. Both real. Neither is an invoice. A customer could see a running
-- balance on a web page and get a "we added $70 to your wallet" email, and had
-- nothing to file, nothing to give an accountant, and no number to quote when
-- asking about a payment. For a registered company taking money from other
-- businesses that is a gap, not a nicety.
--
-- NUMBERED BY A SEQUENCE, not by counting rows. `select count(*) + 1` is the
-- classic way to issue two invoices with the same number: two payments
-- settling in the same second both read the same count. A sequence is atomic
-- and is the only correct answer.
--
-- Gaps are fine and expected -- a sequence advances even when a transaction
-- rolls back. An invoice number has to be UNIQUE and NON-REUSED; it does not
-- have to be gapless, and chasing gaplessness is how people end up with
-- duplicates instead.
--
-- NO VAT. UBAHGRID SERVICE LTD is not registered for VAT with FIRS, and
-- showing a VAT line or a registration number you do not hold is an offence,
-- not a formatting choice. The column exists and stays null so that becoming
-- registered later is a config change rather than a migration.

create sequence if not exists invoice_number_seq;

create table if not exists invoices (
  id uuid primary key default uuid_generate_v4(),
  -- Human-facing, e.g. GL-2026-000014. Unique forever.
  number text not null unique,
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('topup', 'subscription')),
  -- What the customer paid, in the canonical currency.
  amount_usd_minor bigint not null,
  -- And what actually left their account, which is the figure they recognise
  -- on a bank statement. Null for anything not charged in a local currency.
  amount_local_minor bigint,
  local_currency text,
  fx_rate numeric,
  -- Reserved for the day registration happens; null until then.
  vat_usd_minor bigint,
  description text not null,
  psp text,
  -- The idempotency key. The redirect and the webhook both settle the same
  -- charge by design, and a customer must not receive two invoices for one
  -- payment.
  psp_ref text unique,
  issued_at timestamptz not null default now()
);

create index if not exists invoices_business_idx
  on invoices (business_id, issued_at desc);

alter table invoices enable row level security;

-- A customer reads their own invoices and nobody else's. Writes are
-- service-role only, from the settle path: an invoice a customer could create
-- is not evidence of anything.
create policy "via business" on invoices for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

/**
 * Issue one invoice, idempotently.
 *
 * Returns the number either way: on a second settle of the same charge it
 * returns the number already issued rather than minting another or raising.
 * The caller wants "the invoice for this payment", and that is the same
 * answer whether or not this call is the one that created it.
 */
create or replace function issue_invoice(
  p_business_id uuid,
  p_kind text,
  p_amount_usd_minor bigint,
  p_amount_local_minor bigint,
  p_local_currency text,
  p_fx_rate numeric,
  p_description text,
  p_psp text,
  p_psp_ref text
) returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_existing text;
  v_number text;
begin
  if p_psp_ref is not null then
    select number into v_existing from invoices where psp_ref = p_psp_ref;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- GL-<year>-<padded sequence>. The year is cosmetic; the sequence is what
  -- guarantees uniqueness, so a payment settling across midnight on 31
  -- December cannot collide with the first of the new year.
  v_number := 'GL-' || to_char(now(), 'YYYY') || '-' ||
              lpad(nextval('invoice_number_seq')::text, 6, '0');

  insert into invoices (
    number, business_id, kind, amount_usd_minor, amount_local_minor,
    local_currency, fx_rate, description, psp, psp_ref
  ) values (
    v_number, p_business_id, p_kind, p_amount_usd_minor, p_amount_local_minor,
    p_local_currency, p_fx_rate, p_description, p_psp, p_psp_ref
  )
  -- Belt and braces against two settles racing past the check above.
  on conflict (psp_ref) do nothing;

  select number into v_number from invoices
   where psp_ref = p_psp_ref
      or (p_psp_ref is null and number = v_number);
  return v_number;
end $fn$;

revoke all on function issue_invoice(uuid, text, bigint, bigint, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function issue_invoice(uuid, text, bigint, bigint, text, numeric, text, text, text)
  to service_role;
