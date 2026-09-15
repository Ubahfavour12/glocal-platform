/**
 * What order do you put the rows back in?
 *
 * This is the question a restore asks and a backup never does. Exporting is
 * order-free — you read tables in any sequence and nothing objects. Loading is
 * not: `ads` references `campaigns`, which references `ad_accounts`, which
 * references `businesses`. Insert a child before its parent and the foreign key
 * rejects the row. Do that at 3am, under pressure, with the production database
 * empty, and you are debugging a dependency graph by hand instead of restoring.
 *
 * So the order is computed while everything is calm, from the foreign keys the
 * database actually has, and written INTO the backup. The dump is then
 * self-describing: it carries its own restore order and does not depend on the
 * schema still looking the same when you come to read it.
 *
 * Plain ESM for the same reason as the integrity checks: the code that runs is
 * the code that is tested.
 */

/**
 * Kahn's algorithm, with parents emitted before children.
 *
 * `edges` are `{ table, dependsOn }` pairs. Self-references are dropped rather
 * than treated as a cycle: a table whose column points at its own primary key
 * (a parent/child tree in one table) inserts fine as long as the rows within it
 * are ordered, which is the row-level problem below, not a table-level one.
 *
 * Ties break alphabetically. Not for correctness — any topological order is
 * correct — but so that two backups of the same schema produce the same list,
 * which makes a diff of two manifests readable.
 */
export function topoSort(tables, edges) {
  const all = [...new Set(tables)].sort();
  const deps = new Map(all.map((t) => [t, new Set()]));
  const dependents = new Map(all.map((t) => [t, new Set()]));

  for (const e of edges) {
    // Ignore edges pointing outside the set being restored (auth.users, say)
    // and self-references.
    if (!deps.has(e.table) || !deps.has(e.dependsOn)) continue;
    if (e.table === e.dependsOn) continue;
    deps.get(e.table).add(e.dependsOn);
    dependents.get(e.dependsOn).add(e.table);
  }

  const ready = all.filter((t) => deps.get(t).size === 0);
  const out = [];
  while (ready.length > 0) {
    ready.sort();
    const t = ready.shift();
    out.push(t);
    for (const d of dependents.get(t)) {
      const set = deps.get(d);
      set.delete(t);
      if (set.size === 0) ready.push(d);
    }
  }

  // A genuine cycle between two tables (mutual foreign keys) cannot be resolved
  // by ordering alone — it needs deferred constraints. Say so plainly rather
  // than returning a partial list that would fail obscurely halfway through.
  const unresolved = all.filter((t) => !out.includes(t));
  return { order: out, cyclic: unresolved };
}

/** Insert order: parents first. */
export function restoreOrder(tables, edges) {
  return topoSort(tables, edges).order;
}

/**
 * Delete order: children first — the reverse.
 *
 * Needed because restoring over a database that already has rows means clearing
 * it, and clearing has the opposite constraint to filling.
 */
export function clearOrder(tables, edges) {
  return [...topoSort(tables, edges).order].reverse();
}
