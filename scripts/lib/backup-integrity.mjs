/**
 * Is this backup actually usable?
 *
 * WHY THIS EXISTS. There are no backups. Supabase backs up Pro, Team and
 * Enterprise projects daily; this project is on the free plan, where their own
 * documentation says to export your own data and keep it off-site. So the task
 * was never "the restore is untested" — there was nothing to restore. The
 * database holds a money ledger and every customer record.
 *
 * A dump file is not a backup. A backup is a dump you have reason to believe
 * would restore, and the difference is checking. The checks that earn their
 * place are the ones a SILENT failure would otherwise pass:
 *
 *   - A table exported as an empty array because a query errored and the error
 *     was swallowed. The file looks fine. The table is gone.
 *   - A dump taken mid-write, where a wallet's entries no longer sum to its
 *     balance. It restores cleanly and the money is wrong.
 *   - A dump missing a table added by a later migration, because the export
 *     list was written by hand and nobody updated it.
 *
 * All three produce a file of plausible size that opens without error, which is
 * why "we have a backup" is worth so little on its own.
 *
 * Plain ESM rather than TypeScript so the script can import it with no build
 * step and no extra dependency: the code that RUNS is then the code that is
 * tested, instead of a compiled cousin of it.
 */

/** Tables whose loss would be unrecoverable rather than merely inconvenient. */
export const CRITICAL_TABLES = [
  "businesses",
  "wallets",
  "ledger_entries",
  "subscriptions",
  "withdrawals",
  "withdrawal_allocations",
  "ai_generations",
];

/**
 * A table that exported fewer rows than the database says it holds.
 *
 * This is the silent one. A dropped page, a swallowed error, a pagination bug —
 * each produces a shorter array and no complaint anywhere. Comparing against a
 * separately-asked count is the only way to notice.
 */
export function checkCounts(dumps) {
  const out = [];
  for (const d of dumps) {
    if (d.rows.length !== d.reportedCount) {
      out.push({
        level: "error",
        code: "count_mismatch",
        message: `${d.table}: exported ${d.rows.length} rows but the database reports ${d.reportedCount}`,
      });
    }
  }
  return out;
}

/** A critical table missing entirely, or present and empty when it should not be. */
export function checkCriticalTables(dumps) {
  const byName = new Map(dumps.map((d) => [d.table, d]));
  const out = [];
  for (const t of CRITICAL_TABLES) {
    const d = byName.get(t);
    if (!d) {
      out.push({ level: "error", code: "table_missing", message: `${t} is not in this backup at all` });
      continue;
    }
    // Empty is legitimate early on — nobody has withdrawn yet — so this warns
    // rather than fails. It is still worth saying out loud: an empty
    // ledger_entries in a backup taken next year would be a catastrophe that
    // looked exactly like a clean run.
    if (d.rows.length === 0) {
      out.push({
        level: "warn",
        code: "table_empty",
        message: `${t} exported zero rows — correct only if it is genuinely empty`,
      });
    }
  }
  return out;
}

/**
 * Does the money still add up inside the dump?
 *
 * The ledger is append-only and a wallet's balance IS the sum of its entries,
 * so a dump where those disagree was taken while rows were being written, or
 * lost some. Either way it must not be the copy you restore from.
 *
 * Compares against balances the caller read SEPARATELY, so it catches a torn
 * read rather than re-deriving the same number twice and agreeing with itself.
 */
export function checkLedgerSums(ledger, balances) {
  const summed = new Map();
  for (const r of ledger) {
    const id = typeof r?.wallet_id === "string" ? r.wallet_id : null;
    if (!id) continue;
    const amt = Number(r?.amount_usd_minor ?? 0);
    if (!Number.isFinite(amt)) continue;
    summed.set(id, (summed.get(id) ?? 0) + amt);
  }

  const out = [];
  for (const b of balances) {
    const inDump = summed.get(b.wallet_id) ?? 0;
    if (inDump !== Number(b.balance_usd_minor)) {
      out.push({
        level: "error",
        code: "ledger_mismatch",
        message: `wallet ${b.wallet_id}: entries in the backup sum to ${inDump} but the balance is ${b.balance_usd_minor}`,
      });
    }
  }
  return out;
}

/**
 * Every table the schema has, against every table the backup has.
 *
 * Guards the failure where a migration adds a table and the export list, being
 * written by hand, silently keeps backing up the old set.
 */
export function checkCoverage(dumped, schemaTables) {
  const have = new Set(dumped);
  return schemaTables
    .filter((t) => !have.has(t))
    .map((t) => ({
      level: "error",
      code: "not_covered",
      message: `${t} exists in the database but was not exported`,
    }));
}

/** Everything, in one answer. `ok` is false if any error was found. */
export function verifyBackup(input) {
  const ledger = input.dumps.find((d) => d.table === "ledger_entries")?.rows ?? [];
  const findings = [
    ...checkCoverage(input.dumps.map((d) => d.table), input.schemaTables),
    ...checkCriticalTables(input.dumps),
    ...checkCounts(input.dumps),
    ...checkLedgerSums(ledger, input.balances),
  ];
  const errors = findings.filter((f) => f.level === "error").length;
  return { ok: errors === 0, findings, errors, warnings: findings.length - errors };
}
