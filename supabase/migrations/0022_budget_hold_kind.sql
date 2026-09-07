-- Ad budget holds, part 1 of 2: the ledger kind itself.
--
-- Deliberately alone in its own migration. Postgres will not let a newly added
-- enum value be USED in the same transaction that adds it, so the table and
-- functions that reference 'budget_hold' live in 0023 and run afterwards.
-- Combining them appears to work right up until the first execution fails.

alter type ledger_kind add value if not exists 'budget_hold';
