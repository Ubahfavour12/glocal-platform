/**
 * Take a backup, and check it is one.
 *
 * THERE ARE NO BACKUPS. Supabase backs up Pro, Team and Enterprise projects
 * daily; this project is on the free plan, where their own documentation says
 * to export your own data and keep it off-site. So this is not a second copy
 * alongside theirs — for now it is the only copy there is.
 *
 *   npm run backup             -> writes backups/<timestamp>/ and verifies it
 *   npm run backup -- --verify backups/2026-09-15T12-00-00Z
 *                              -> re-checks an existing backup, no export
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service key
 * is required because the point is to copy EVERY row, and row-level security
 * exists precisely to stop that.
 *
 * WHAT THIS IS NOT. It is a logical export of table contents and Storage files.
 * It does not carry the schema, the RLS policies, the functions, or the auth
 * users — those live in the migrations in this repo, which is its own kind of
 * backup and is why they are committed rather than applied by hand.
 *
 * It DOES now include Storage. Customers' product photos are the one thing even
 * Supabase's own paid backups do not cover, which makes them the only data here
 * that nobody would be copying if this script did not. Pass --no-media to skip
 * them when you only want the rows and want them quickly.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { createHash } from "node:crypto";

// The checks live beside this file and are unit tested there. They are plain
// ESM, not TypeScript, specifically so that this import needs no build step:
// the code that RUNS is then the code that is tested, rather than a compiled
// cousin of it.
import { verifyBackup } from "./lib/backup-integrity.mjs";
import { restoreOrder } from "./lib/table-order.mjs";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Page size. Supabase caps a single response, so everything is paged. */
const PAGE = 1000;

const args = process.argv.slice(2);
const verifyOnly = args.indexOf("--verify");
const skipMedia = args.includes("--no-media");

/** The bucket holding customers' uploaded product photos. */
const MEDIA_BUCKET = "product-media";

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

/**
 * Read a PostgREST path to exhaustion.
 *
 * Everything pages. Supabase caps a single response, so a plain GET returns the
 * first page and no indication that there were more — which is exactly the
 * silent truncation this whole script exists to catch, and it would be
 * embarrassing to commit it here.
 */
async function readAll(path) {
  const rows = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    if (total === null) {
      const t = Number((res.headers.get("content-range") ?? "").split("/")[1]);
      total = Number.isFinite(t) ? t : page.length;
    }
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, total };
}

/**
 * Every table the schema actually has, asked of the database, not hardcoded.
 *
 * Returns `{ table_name, pk_column }`. The primary key comes back because
 * paging without an ORDER BY is undefined in Postgres: the planner is free to
 * return one row on two pages and another on none, and the row count still
 * comes out right. That is a corrupt backup that passes every check.
 */
async function listTables() {
  const res = await fetch(`${URL_}/rest/v1/rpc/backup_table_list`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      `could not list tables (${res.status}). Has migration 0029 been applied?`,
    );
  }
  return await res.json();
}

/** Foreign keys, so the manifest can record the order to put rows back in. */
async function listDeps() {
  const res = await fetch(`${URL_}/rest/v1/rpc/backup_table_deps`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      `could not read foreign keys (${res.status}). Has migration 0031 been applied?`,
    );
  }
  const rows = await res.json();
  return rows.map((r) => ({ table: r.table_name, dependsOn: r.depends_on }));
}

async function dumpTable(table, pk) {
  const order = pk ? `&order=${encodeURIComponent(pk)}.asc` : "";
  const { rows, total } = await readAll(`${table}?select=*${order}`);
  return { table, rows, reportedCount: total, ordered: Boolean(pk) };
}

/**
 * Every object in the media bucket.
 *
 * Storage lists one folder at a time, and files are stored under a folder per
 * business, so this walks: list the root to get the business folders, then list
 * each. A file is distinguished from a folder by having an `id` — folders come
 * back as synthetic entries with a null id, which is not obvious and is the
 * kind of thing that silently backs up zero files if you get it wrong.
 */
async function listStorage(prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${URL_}/storage/v1/object/list/${MEDIA_BUCKET}`, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`storage list ${prefix}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) out.push({ path, size: entry.metadata?.size ?? null });
      else out.push(...(await listStorage(path)));
    }
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function downloadObject(path, dest) {
  const res = await fetch(
    `${URL_}/storage/v1/object/${MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) throw new Error(`storage get ${path}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

function loadDumps(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const dumps = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  return { manifest, dumps };
}

function report(verdict) {
  for (const f of verdict.findings) {
    const tag = f.level === "error" ? "ERROR" : "warn ";
    console.log(`  ${tag}  ${f.message}`);
  }
  if (verdict.findings.length === 0) console.log("  every check passed");
  console.log(
    `\n  ${verdict.errors} error(s), ${verdict.warnings} warning(s) — ` +
      (verdict.ok ? "this backup looks restorable" : "DO NOT rely on this backup"),
  );
}

async function main() {
  // The credential check sits AFTER the --verify branch on purpose. Re-checking
  // a backup you already hold reads local files and touches no network, so
  // demanding the service key for it would be asking someone to put the most
  // dangerous secret in the project on their shell history for no reason.
  if (verifyOnly !== -1) {
    const dir = args[verifyOnly + 1];
    if (!dir || !existsSync(dir)) die("Pass the backup directory: --verify backups/<timestamp>");
    const { manifest, dumps } = loadDumps(dir);
    console.log(`\n  Verifying ${dir} (taken ${manifest.takenAt})\n`);
    report(
      verifyBackup({
        dumps,
        schemaTables: manifest.schemaTables ?? dumps.map((d) => d.table),
        balances: manifest.balances ?? [],
      }),
    );
    return;
  }

  if (!URL_ || !KEY) {
    die("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  }

  const catalogue = await listTables();
  const tables = catalogue.map((t) => t.table_name);
  const edges = await listDeps();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join("backups", stamp);
  mkdirSync(dir, { recursive: true });

  console.log(`\n  Backing up ${tables.length} tables to ${dir}\n`);

  const dumps = [];
  for (const { table_name: t, pk_column: pk } of catalogue) {
    const d = await dumpTable(t, pk);
    writeFileSync(join(dir, `${t}.json`), JSON.stringify(d, null, 1));
    dumps.push(d);
    console.log(`  ${String(d.rows.length).padStart(6)}  ${t}${pk ? "" : "   (no primary key — page order not guaranteed)"}`);
  }

  // Balances are read SEPARATELY from the ledger so the check compares two
  // independent reads. Re-deriving both from the same rows would only prove the
  // arithmetic, not that the export is complete.
  const { rows: balances } = await readAll(
    "wallet_balances?select=wallet_id,balance_usd_minor",
  );

  // Storage last: it is the slow part, and a failure here should not cost the
  // row export that already succeeded. Recorded in the manifest either way, so
  // a backup that skipped media says so rather than looking complete.
  let media = { skipped: true, files: 0, bytes: 0 };
  if (!skipMedia) {
    console.log(`\n  Backing up ${MEDIA_BUCKET}\n`);
    const objects = await listStorage();
    let bytes = 0;
    for (const o of objects) {
      bytes += await downloadObject(o.path, join(dir, "storage", MEDIA_BUCKET, o.path));
    }
    media = { skipped: false, files: objects.length, bytes };
    console.log(`  ${String(objects.length).padStart(6)}  files (${(bytes / 1e6).toFixed(1)} MB)`);
  }

  const manifest = {
    takenAt: new Date().toISOString(),
    media,
    projectUrl: URL_,
    tables: dumps.map((d) => ({ table: d.table, rows: d.rows.length })),
    schemaTables: tables,
    // Recorded at backup time, on purpose. A restore then follows the order the
    // schema had WHEN THE DUMP WAS TAKEN, rather than asking a database that may
    // since have changed — or may, at the moment you need it, be gone.
    restoreOrder: restoreOrder(tables, edges),
    balances,
    sha256: createHash("sha256")
      .update(dumps.map((d) => `${d.table}:${d.rows.length}`).join("|"))
      .digest("hex"),
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));

  console.log(`\n  Verifying what was just written\n`);
  const verdict = verifyBackup({ dumps, schemaTables: tables, balances });
  report(verdict);

  // A failed backup must fail the command. A cron that reports success on a
  // broken export is worse than no cron, because it manufactures confidence.
  if (!verdict.ok) process.exit(1);
}

main().catch((e) => die(e.message));
