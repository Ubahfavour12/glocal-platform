-- The foreign keys, so a backup can carry its own restore order.
--
-- Exporting is order-free; loading is not. `ads` references `campaigns`, which
-- references `ad_accounts`, which references `businesses`. Put a child back
-- before its parent and the foreign key rejects it. Working that graph out by
-- hand, at 3am, against an empty production database, is not a restore plan.
--
-- So the order is computed while everything is calm and written INTO the
-- manifest. The dump then describes its own restore and does not depend on the
-- schema still looking the same — or on this function still existing — by the
-- time somebody needs it.

/**
 * One row per foreign key: `table_name` must be loaded after `depends_on`.
 *
 * Only relationships between base tables in `public` are reported. An edge
 * pointing somewhere this backup does not reach — `businesses.owner_id` at
 * `auth.users`, which Supabase owns and this export does not carry — is left
 * out, because it is not an ordering constraint among the rows being restored.
 * The caller drops self-references itself; a table pointing at its own key is a
 * row-ordering problem, not a table-ordering one.
 */
create or replace function backup_table_deps()
returns table (table_name text, depends_on text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select distinct
    child.relname::text,
    parent.relname::text
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace nc on nc.oid = child.relnamespace
  join pg_namespace np on np.oid = parent.relnamespace
  where c.contype = 'f'
    and nc.nspname = 'public'
    and np.nspname = 'public'
    and child.relkind = 'r'
    and parent.relkind = 'r'
  order by 1, 2;
$$;

/**
 * Service role only, for the same reason as `backup_table_list`: this is a map
 * of how the schema fits together, and no browser session has any use for it.
 * PUBLIC is revoked first because Postgres grants EXECUTE to PUBLIC on every new
 * function by default — granting without revoking would leave it open to anon
 * and authenticated too.
 */
revoke all on function backup_table_deps() from public, anon, authenticated;
grant execute on function backup_table_deps() to service_role;
