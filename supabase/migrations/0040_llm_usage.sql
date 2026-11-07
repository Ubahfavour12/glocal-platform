-- What the LLM actually costs, per business.
--
-- Nothing measured this. `callClaude` read the reply's text and threw the
-- response's `usage` block away, so concept generation, trait extraction and
-- compliance judgement were free as far as the system knew. admin/economics.ts
-- then computed margin as revenue minus RENDER cost and called the result the
-- margin -- so a business with no renders and heavy copy generation read as
-- pure profit, and `underwater` could never fire for an account the LLM bill
-- had sunk.
--
-- WHY NOT ai_generations. That table exists for a single legal job: proving
-- what a model produced that a person might take for human-made. Filling it
-- with trait extraction and market analysis -- neither of which is published
-- to anyone -- would wreck the one question it can answer. It is also
-- append-only by trigger, which is right for a compliance record and wrong for
-- a cost table that may need correcting when a real invoice arrives.
--
-- WHY MICRO-DOLLARS. A Haiku 5.5 call on a 2,000-token prompt costs about
-- $0.0003. In minor units that is zero, and a month of zeros is exactly how a
-- team concludes the LLM is free. Micros (1e-6 USD) keep a single call
-- representable; the conversion to cents happens once, in aggregate, where the
-- number is large enough for a cent to mean anything.
--
-- Not deleted by erase_business: once the business row is anonymised these
-- rows describe a cost against an identifier that resolves to nobody, the
-- same treatment the ledger gets and for the same reason.

create table if not exists llm_usage (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- The specific model id. "claude" is not an answer to "what did this cost",
  -- because the models in use differ by a factor of twenty per token.
  model text not null,
  -- Which step spent it: concepts, traits, compliance, ask. The point of
  -- recording cost per business is to find the expensive step, and a single
  -- total cannot.
  purpose text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  -- Computed from a CONFIGURED rate table, not returned by the API. Published
  -- list prices, overridable from the environment -- an estimate that can be
  -- corrected in one place, which is the whole argument for writing it down.
  cost_usd_micros bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists llm_usage_business_idx
  on llm_usage (business_id, created_at desc);
create index if not exists llm_usage_created_idx
  on llm_usage (created_at desc);

alter table llm_usage enable row level security;

-- A customer may read what their own account cost to run. Nothing may write
-- through the API: these rows are written by the server with the service role,
-- so a browser that could insert them could also fake a month of cheap months.
create policy "via business" on llm_usage for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));
