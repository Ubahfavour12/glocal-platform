import { describe, expect, it } from "vitest";
import {
  CRITICAL_TABLES,
  checkCounts,
  checkCoverage,
  checkCriticalTables,
  checkLedgerSums,
  verifyBackup,
} from "./backup-integrity.mjs";

const dump = (table, n, reported = n) => ({
  table,
  rows: new Array(n).fill({}),
  reportedCount: reported,
});

const fullDump = () => CRITICAL_TABLES.map((t) => dump(t, 3));

describe("checkCounts — the silent failure", () => {
  it("catches a table that exported fewer rows than the database holds", () => {
    // A swallowed error or a dropped page produces a shorter array and no
    // complaint anywhere. Comparing against a separately-asked count is the
    // only way to see it.
    const f = checkCounts([dump("businesses", 12, 13)]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "error", code: "count_mismatch" });
    expect(f[0].message).toContain("12");
    expect(f[0].message).toContain("13");
  });

  it("catches a table that exported MORE than reported", () => {
    // Rarer, but it means the two reads disagree, which is equally untrustworthy.
    expect(checkCounts([dump("businesses", 14, 13)])).toHaveLength(1);
  });

  it("passes when they agree", () => {
    expect(checkCounts([dump("businesses", 13, 13)])).toHaveLength(0);
  });

  it("passes on a genuinely empty table", () => {
    expect(checkCounts([dump("withdrawals", 0, 0)])).toHaveLength(0);
  });
});

describe("checkCriticalTables", () => {
  it("errors when a critical table is absent from the backup entirely", () => {
    const missing = fullDump().filter((d) => d.table !== "ledger_entries");
    const f = checkCriticalTables(missing);
    expect(f).toContainEqual(
      expect.objectContaining({ level: "error", code: "table_missing" }),
    );
  });

  it("warns rather than fails on an empty critical table", () => {
    // Nobody has withdrawn yet, so empty is legitimate today — but it must
    // still be said out loud, because an empty ledger next year would be a
    // catastrophe that looked like a clean run.
    const f = checkCriticalTables(
      fullDump().map((d) => (d.table === "ledger_entries" ? dump("ledger_entries", 0) : d)),
    );
    const empty = f.filter((x) => x.code === "table_empty");
    expect(empty.length).toBeGreaterThan(0);
    expect(empty[0].level).toBe("warn");
  });

  it("is quiet when every critical table is present and populated", () => {
    expect(checkCriticalTables(fullDump())).toHaveLength(0);
  });
});

describe("checkLedgerSums — the money must still add up", () => {
  const ledger = [
    { wallet_id: "w1", amount_usd_minor: 7000 },
    { wallet_id: "w1", amount_usd_minor: -2000 },
    { wallet_id: "w2", amount_usd_minor: 500 },
  ];

  it("passes when the entries in the dump sum to the recorded balances", () => {
    expect(
      checkLedgerSums(ledger, [
        { wallet_id: "w1", balance_usd_minor: 5000 },
        { wallet_id: "w2", balance_usd_minor: 500 },
      ]),
    ).toHaveLength(0);
  });

  it("catches a torn read where an entry is missing from the dump", () => {
    // Restores cleanly; the money is wrong. This is the one that must fail.
    const f = checkLedgerSums(ledger.slice(0, 2), [
      { wallet_id: "w1", balance_usd_minor: 5000 },
      { wallet_id: "w2", balance_usd_minor: 500 },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "ledger_mismatch" });
    expect(f[0].message).toContain("w2");
  });

  it("treats a wallet with no entries as zero, not as absent", () => {
    const f = checkLedgerSums([], [{ wallet_id: "w9", balance_usd_minor: 100 }]);
    expect(f).toHaveLength(1);
  });

  it("ignores malformed rows rather than throwing on them", () => {
    // A verifier that crashes on one odd row reports nothing about the rest.
    expect(() =>
      checkLedgerSums(
        [{ wallet_id: null }, { amount_usd_minor: "x" }, null, "junk"],
        [{ wallet_id: "w1", balance_usd_minor: 0 }],
      ),
    ).not.toThrow();
  });
});

describe("checkCoverage", () => {
  it("catches a table the schema has and the backup does not", () => {
    // The failure where a migration adds a table and the hand-written export
    // list quietly keeps backing up the old set.
    const f = checkCoverage(["businesses"], ["businesses", "budget_holds"]);
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("budget_holds");
  });

  it("is quiet when everything is covered", () => {
    expect(checkCoverage(["a", "b"], ["a", "b"])).toHaveLength(0);
  });

  it("does not complain about extra tables in the dump", () => {
    expect(checkCoverage(["a", "b", "c"], ["a", "b"])).toHaveLength(0);
  });
});

describe("verifyBackup", () => {
  const good = {
    dumps: [
      ...fullDump().filter((d) => d.table !== "ledger_entries"),
      { table: "ledger_entries", rows: [{ wallet_id: "w1", amount_usd_minor: 100 }], reportedCount: 1 },
    ],
    schemaTables: [...CRITICAL_TABLES],
    balances: [{ wallet_id: "w1", balance_usd_minor: 100 }],
  };

  it("passes a sound backup", () => {
    const v = verifyBackup(good);
    expect(v.ok).toBe(true);
    expect(v.errors).toBe(0);
  });

  it("fails on any error, and counts warnings separately", () => {
    const v = verifyBackup({
      ...good,
      balances: [{ wallet_id: "w1", balance_usd_minor: 999 }],
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toBe(1);
  });

  it("stays ok when there are only warnings", () => {
    const v = verifyBackup({
      ...good,
      dumps: good.dumps.map((d) =>
        d.table === "withdrawals" ? { ...d, rows: [], reportedCount: 0 } : d,
      ),
    });
    expect(v.ok).toBe(true);
    expect(v.warnings).toBeGreaterThan(0);
  });
});
