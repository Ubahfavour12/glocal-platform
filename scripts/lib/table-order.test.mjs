import { describe, expect, it } from "vitest";
import { clearOrder, restoreOrder, topoSort } from "./table-order.mjs";

const before = (order, a, b) => order.indexOf(a) < order.indexOf(b);

describe("restoreOrder — parents before children", () => {
  it("puts a parent before its child", () => {
    const o = restoreOrder(["ads", "campaigns"], [{ table: "ads", dependsOn: "campaigns" }]);
    expect(before(o, "campaigns", "ads")).toBe(true);
  });

  it("resolves a chain three deep", () => {
    // businesses <- ad_accounts <- campaigns <- ads, given in the wrong order.
    const o = restoreOrder(
      ["ads", "campaigns", "ad_accounts", "businesses"],
      [
        { table: "ads", dependsOn: "campaigns" },
        { table: "campaigns", dependsOn: "ad_accounts" },
        { table: "ad_accounts", dependsOn: "businesses" },
      ],
    );
    expect(o).toEqual(["businesses", "ad_accounts", "campaigns", "ads"]);
  });

  it("handles a table with two parents", () => {
    const o = restoreOrder(
      ["ads", "campaigns", "creatives"],
      [
        { table: "ads", dependsOn: "campaigns" },
        { table: "ads", dependsOn: "creatives" },
      ],
    );
    expect(before(o, "campaigns", "ads")).toBe(true);
    expect(before(o, "creatives", "ads")).toBe(true);
  });

  it("includes tables that depend on nothing", () => {
    const o = restoreOrder(["audit_log", "businesses"], []);
    expect(o).toHaveLength(2);
  });

  it("is deterministic, so two manifests can be diffed", () => {
    const tables = ["c", "a", "b"];
    const edges = [{ table: "c", dependsOn: "a" }];
    expect(restoreOrder(tables, edges)).toEqual(restoreOrder([...tables].reverse(), edges));
  });
});

describe("edges that must not break it", () => {
  it("ignores a self-reference rather than calling it a cycle", () => {
    // A parent/child tree inside one table. Table-level ordering cannot help
    // and must not stall on it.
    const { order, cyclic } = topoSort(["concepts"], [{ table: "concepts", dependsOn: "concepts" }]);
    expect(order).toEqual(["concepts"]);
    expect(cyclic).toHaveLength(0);
  });

  it("ignores an edge pointing outside the restored set", () => {
    // businesses.owner_id references auth.users, which this backup does not
    // carry. That must not drop businesses from the order.
    const o = restoreOrder(["businesses"], [{ table: "businesses", dependsOn: "auth.users" }]);
    expect(o).toEqual(["businesses"]);
  });

  it("reports a genuine two-table cycle instead of silently truncating", () => {
    // Mutual foreign keys need deferred constraints; ordering cannot fix it.
    // Returning a short list quietly would fail halfway through a restore.
    const { order, cyclic } = topoSort(
      ["withdrawals", "ledger_entries"],
      [
        { table: "withdrawals", dependsOn: "ledger_entries" },
        { table: "ledger_entries", dependsOn: "withdrawals" },
      ],
    );
    expect(order).toHaveLength(0);
    expect(cyclic.sort()).toEqual(["ledger_entries", "withdrawals"]);
  });
});

describe("clearOrder — children first", () => {
  it("is the exact reverse of the restore order", () => {
    const tables = ["ads", "campaigns", "businesses"];
    const edges = [
      { table: "ads", dependsOn: "campaigns" },
      { table: "campaigns", dependsOn: "businesses" },
    ];
    expect(clearOrder(tables, edges)).toEqual([...restoreOrder(tables, edges)].reverse());
  });

  it("deletes a child before the parent it points at", () => {
    const o = clearOrder(["ads", "campaigns"], [{ table: "ads", dependsOn: "campaigns" }]);
    expect(before(o, "ads", "campaigns")).toBe(true);
  });
});
