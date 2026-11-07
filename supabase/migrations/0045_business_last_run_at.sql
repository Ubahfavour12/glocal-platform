-- Which businesses the agent has actually got to.
--
-- THE STARVATION BUG. The nightly job selects every business with no ORDER BY
-- and works through them until the lambda's 300-second ceiling kills it. The
-- order Postgres returns is arbitrary but STABLE, so the businesses at the end
-- of it are the same ones every night. The run does not degrade evenly as the
-- customer list grows -- it silently stops serving a fixed tail, and those
-- customers see an agent that has quietly given up while every dashboard still
-- says it runs nightly.
--
-- Today there are eight businesses and three that are not dormant, so nothing
-- is being starved yet. That is exactly why it is worth fixing now: the first
-- symptom is a customer who cannot tell you why their ads stopped, and the
-- cause is invisible from every screen.
--
-- With a stamp, the fix is an ORDER BY. Least-recently-run first means whoever
-- was cut off last night is served first tonight, so over a few nights
-- everyone is covered even if no single run ever finishes the list. A second
-- cron pass later in the night then picks up whoever a long run deferred.
--
-- Nullable, and nulls sort FIRST: a business that has never run is the most
-- urgent, not the least.

alter table businesses
  add column if not exists last_run_at timestamptz;

-- The ordering the nightly job reads. Nulls first matches `order by
-- last_run_at asc nulls first`, so a brand-new business goes to the head of
-- the queue rather than the tail.
create index if not exists businesses_last_run_idx
  on businesses (last_run_at asc nulls first);
