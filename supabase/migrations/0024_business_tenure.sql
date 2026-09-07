-- When the business started trading.
--
-- Asked once during onboarding and never used to gate anything. It is a
-- retention signal: a shop three months old and a shop of fifteen years are
-- different customers with different reasons to leave, and knowing which is
-- which is the difference between guessing at churn and understanding it.
--
-- A YEAR rather than a full date, deliberately. Owners recall the year they
-- started without thinking; a day and month invites a made-up answer, and a
-- fabricated precise date is worse than an honest coarse one. Nullable, because
-- the question can be skipped and an unanswered question must not become a
-- wrong answer.

alter table businesses add column if not exists founded_year smallint;

-- Sanity only, not validation theatre. 1800 rules out a typo'd 180 or 18000;
-- the upper bound is checked in the application against the actual current
-- year, which the database has no business hardcoding.
alter table businesses
  add constraint businesses_founded_year_sane
  check (founded_year is null or (founded_year >= 1800 and founded_year <= 2200));

comment on column businesses.founded_year is
  'Year the business started trading. Retention signal only; never gates anything.';
