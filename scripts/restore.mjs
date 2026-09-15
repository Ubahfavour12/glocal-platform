/**
 * Put the rows back.
 *
 * WHY THIS EXISTS. `npm run backup` wrote JSON that nothing could read. That is
 * not a backup, it is a file — and the gap only shows up on the one day it
 * matters, when the answer to "can we restore?" has to be demonstrated rather
 * than assumed. Rehearsing the restore is what turned this up.
 *
 *   npm run restore -- backups/<timestamp> --dry-run   what it WOULD do
 *   npm run restore -- backups/<timestamp>             actually load it
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, pointed at the
 * project being restored INTO. Read that sentence twice: the commonest way to
 * turn a bad day into a catastrophe is to run this against the database you
 * still have.
 *
 * WHAT IT ASSUMES. The schema already exists — run the migrations first, in
 * order, into an empty project. This loads data only: it does not create
 * tables, policies or functions, and it does not restore auth users, who live
 * in Supabase Auth rather than in these tables.
 *
 * It DOES restore Storage files when the backup carries them, because a backup
 * that saves photos and a restore that cannot put them back is a half-built
 * thing that looks finished.
 *
 * ORDER. Rows go back parents-first, following the order recorded in the
 * manifest at backup time. Insert a child before its parent and the foreign key
 * rejects it; working that graph out by hand mid-incident is exactly what this
 * avoids.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { verifyBackup } from "./lib/backup-integrity.mjs";
import { restoreOrder as computeOrder } from "./lib/table-order.mjs";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Rows per request. Large enough to be quick, small enough to stay debuggable. */
const CHUNK = 500;

/** Must match the bucket the backup wrote. */
const MEDIA_BUCKET = "product-media";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function loadBackup(d) {
  const manifest = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
  const dumps = manifest.tables.map(({ table }) =>
    JSON.parse(readFileSync(join(d, `${table}.json`), "utf8")),
  );
  return { manifest, dumps };
}

async function rpc(path, body = "{}") {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return await res.json();
}

/** How many rows are already there? */
async function countRows(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  const n = Number((res.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}

async function insertChunk(table, rows) {
  const res = await fetch(`${URL_}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      // Return nothing: we do not need the rows echoed back, and a large
      // response is just bytes and time on a job that is already anxious.
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
}

/** Every file under a directory, as paths relative to it. */
function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Put the photos back.
 *
 * `upsert` is on because a restore is the one time overwriting is the intent:
 * if a partial run already placed a file, the correct behaviour is to replace
 * it with the backup's copy rather than fail and leave the object store half
 * populated with no obvious way to finish.
 */
async function restoreStorage(dir) {
  const root = join(dir, "storage", MEDIA_BUCKET);
  if (!existsSync(root)) return 0;
  const files = walkFiles(root);
  for (const f of files) {
    const path = relative(root, f).split(sep).join("/");
    const res = await fetch(
      `${URL_}/storage/v1/object/${MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          "x-upsert": "true",
          "Content-Type": "application/octet-stream",
        },
        body: readFileSync(f),
      },
    );
    if (!res.ok) throw new Error(`storage put ${path}: ${res.status} ${await res.text()}`);
  }
  return files.length;
}

async function main() {
  if (!dir || !existsSync(dir)) {
    die("Which backup? npm run restore -- backups/<timestamp> [--dry-run]");
  }
  if (!URL_ || !KEY) {
    die("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  }

  const { manifest, dumps } = loadBackup(dir);

  // Check the backup before trusting it. Restoring FROM a dump that failed its
  // own integrity checks would write known-bad data over whatever is there.
  const verdict = verifyBackup({
    dumps,
    schemaTables: manifest.schemaTables ?? dumps.map((d) => d.table),
    balances: manifest.balances ?? [],
  });
  console.log(`\n  Backup taken ${manifest.takenAt}`);
  console.log(`  Restoring into ${URL_}\n`);
  for (const f of verdict.findings) {
    console.log(`  ${f.level === "error" ? "ERROR" : "warn "}  ${f.message}`);
  }
  if (!verdict.ok && !force) {
    die(
      `This backup fails its own integrity checks (${verdict.errors} error(s)).\n` +
        "  Restoring it would write data we already know is wrong.\n" +
        "  Re-read them above; --force overrides, deliberately.",
    );
  }

  // Older manifests predate the recorded order; fall back to deriving it, and
  // say so, because a derived order is only as good as today's schema.
  let order = manifest.restoreOrder;
  if (!Array.isArray(order) || order.length === 0) {
    console.log("\n  This backup records no restore order (taken before 0031).");
    console.log("  Deriving it from the TARGET database instead.\n");
    const rows = await rpc("rpc/backup_table_deps");
    order = computeOrder(
      dumps.map((d) => d.table),
      rows.map((r) => ({ table: r.table_name, dependsOn: r.depends_on })),
    );
  }

  const byName = new Map(dumps.map((d) => [d.table, d]));
  const plan = order.filter((t) => byName.has(t));

  // Refuse to load on top of existing rows. A restore into a live database
  // duplicates everything it touches, and the ledger is append-only — there is
  // no clean way back from that.
  if (!dryRun) {
    const occupied = [];
    for (const t of plan) {
      if ((await countRows(t)) > 0) occupied.push(t);
    }
    if (occupied.length > 0 && !force) {
      die(
        `The target database is NOT empty — rows already in: ${occupied.join(", ")}.\n` +
          "  Loading on top would duplicate them, and ledger_entries is append-only,\n" +
          "  so there is no clean undo. Restore into an empty project, or pass\n" +
          "  --force if you are certain this is what you want.",
      );
    }
  }

  console.log(`\n  ${dryRun ? "Would load" : "Loading"} ${plan.length} tables, parents first\n`);

  let total = 0;
  for (const t of plan) {
    const rows = byName.get(t).rows;
    total += rows.length;
    if (dryRun) {
      console.log(`  ${String(rows.length).padStart(6)}  ${t}`);
      continue;
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      await insertChunk(t, rows.slice(i, i + CHUNK));
    }
    console.log(`  ${String(rows.length).padStart(6)}  ${t}`);
  }

  if (dryRun) {
    const root = join(dir, "storage", MEDIA_BUCKET);
    const media = existsSync(root) ? walkFiles(root).length : 0;
    console.log(
      `\n  Dry run — nothing written. ${total} rows and ${media} file(s) would be loaded.\n`,
    );
    return;
  }

  const restored = await restoreStorage(dir);
  if (restored > 0) console.log(`\n  ${restored} Storage file(s) restored`);
  else if (manifest.media?.skipped) {
    console.log("\n  This backup was taken with --no-media, so there are no photos to restore.");
  }

  // Count what actually landed. An insert that silently dropped rows is the
  // same class of failure the backup verifier exists to catch, and it would be
  // absurd to be careful on the way out and credulous on the way back in.
  console.log(`\n  Checking what landed\n`);
  let bad = 0;
  for (const t of plan) {
    const want = byName.get(t).rows.length;
    const got = await countRows(t);
    if (got !== want) {
      console.log(`  ERROR  ${t}: expected ${want} rows, found ${got}`);
      bad++;
    }
  }
  console.log(
    bad === 0
      ? `\n  ${total} rows restored, every table matches.\n`
      : `\n  ${bad} table(s) do not match. DO NOT treat this restore as complete.\n`,
  );
  if (bad > 0) process.exit(1);
}

main().catch((e) => die(e.message));
