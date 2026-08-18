-- When this business's ads go live each day.
--
-- Two separate things were tangled together before. The approval card let a
-- gated customer pick a moment, but only one plan at a time, so the same
-- preference had to be re-expressed every single evening. Full-auto customers
-- had no control at all: their ads fired whenever the cron happened to run,
-- which nobody chose, it just fell out of how the job was written.
--
-- One preference, stored once, read by both modes. Full auto means "do not ask
-- me", never "go at an hour I did not pick".
--
-- The timezone is stored beside the hour because 7am has to mean 7am where the
-- shop is. Defaults to Lagos, the first market, and is captured from the
-- browser when a customer sets it.

alter table businesses
  add column if not exists launch_hour smallint not null default 7
    check (launch_hour between 0 and 23),
  add column if not exists launch_timezone text not null default 'Africa/Lagos';

comment on column businesses.launch_hour is
  'Local hour (0-23) ads should go live. Read by the approval card as a default and by the launcher for full-auto accounts.';
