-- What is there to back up? Ask the database, not a list someone wrote once.
--
-- THERE ARE NO BACKUPS TODAY. Supabase backs up Pro, Team and Enterprise
-- projects daily; this project is on the free plan, where their own
-- documentation says to export your own data and keep it off-site. The
-- database holds every business, every user row and the whole money ledger.
-- `npm run backup` is that export, and this function is what tells it what to
-- copy.
--
-- It exists because of one specific failure: a hand-written export list. A
-- migration adds a table, nobody remembers to add it to the list, and every
-- backup from then on is quietly missing it. Nothing fails. The gap surfaces
-- on the day you restore, which is the worst possible day to find it.

/**
 * Every base table in `public`, with its primary key column.
 *
 * VIEWS ARE DELIBERATELY EXCLUDED. `wallet_balances` is a view over
 * `ledger_entries`; copying it would store a derived number as though it were a
 * fact, and a restore would then have two sources of truth for money that could
 * disagree. The backup verifier reads that view separately and uses it to
 * CHECK the ledger, which is the opposite job.
 *
 * The primary key comes back because paging without an ORDER BY is undefined in
 * Postgres. The planner may hand the same row to two pages and another to none;
 * the total count still comes out right, so the export looks complete and is
 * not. Ordering by the key makes the paging deterministic. A composite key
 * reports its first column, which is enough to make the order stable; a table
 * with no key at all reports NULL and the script says so out loud rather than
 * pretending.
 */
create or replace function backup_table_list()
returns table (table_name text, pk_column text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    c.relname::text,
    (
      select a.attname::text
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid
       and a.attnum = i.indkey[0]
      where i.indrelid = c.oid
        and i.indisprimary
      limit 1
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'          -- ordinary tables only: no views, no matviews
    and c.relpersistence = 'p'   -- no temp or unlogged tables
  order by c.relname;
$$;

/**
 * Only the service role may ask.
 *
 * This is a map of the whole schema. On its own it leaks no rows, but it tells
 * an attacker exactly which table names to try, and there is no reason for a
 * browser session to ever call it. The backup script already requires the
 * service key — copying every row is the entire point, and row-level security
 * exists precisely to prevent that — so nothing else loses anything here.
 *
 * REVOKE FROM PUBLIC comes first: Postgres grants EXECUTE to PUBLIC on every
 * new function by default, so granting to service_role without revoking would
 * leave it open to anon and authenticated as well.
 */
revoke all on function backup_table_list() from public, anon, authenticated;
grant execute on function backup_table_list() to service_role;
