/**
 * Does the schema hold up at a size nobody has tried?
 *
 * "It scales" is a claim about query plans, not about hope. This builds a large
 * database in a temp file, asks SQLite how it intends to answer the hot queries,
 * and times them. A sequential scan hiding behind a fast answer on 8 rows is
 * exactly what this is looking for.
 *
 *   node --experimental-strip-types api/scripts/check-scale.ts 5000
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store.ts";
import { NSE_SYMBOLS } from "../src/db/symbols.ts";

const SESSIONS = Number(process.argv[2] ?? 5000);
const LISTS_EACH = 3;
const SYMBOLS_EACH = 20;

const dir = mkdtempSync(join(tmpdir(), "meanwhile-scale-"));
const path = join(dir, "scale.db");

console.log(`\nbuilding ${SESSIONS.toLocaleString()} sessions × ${LISTS_EACH} lists × ${SYMBOLS_EACH} symbols…`);
const store = new Store(path);
store.close();

const db = new Database(path);
db.pragma("journal_mode = WAL");

const insertSession = db.prepare("INSERT INTO sessions (id, created_at) VALUES (?, ?)");
const insertList = db.prepare(
  "INSERT INTO watchlists (id, session_id, name, created_at) VALUES (?, ?, ?, ?)",
);
const insertItem = db.prepare(
  "INSERT INTO watchlist_items (list_id, session_id, symbol, added_at, intent) VALUES (?, ?, ?, ?, 'none')",
);
const insertSeen = db.prepare(
  "INSERT OR IGNORE INTO seen_state (session_id, symbol, last_seen_at) VALUES (?, ?, ?)",
);

const now = Date.now();
let probeSession = "";

const build = db.transaction(() => {
  for (let s = 0; s < SESSIONS; s++) {
    const sid = randomUUID();
    if (s === Math.floor(SESSIONS / 2)) probeSession = sid;
    insertSession.run(sid, now);

    for (let l = 0; l < LISTS_EACH; l++) {
      const lid = randomUUID();
      insertList.run(lid, sid, `List ${l}`, now);
      for (let i = 0; i < SYMBOLS_EACH; i++) {
        const sym = NSE_SYMBOLS[(s + l * 7 + i * 3) % NSE_SYMBOLS.length]!.symbol;
        insertItem.run(lid, sid, sym, now);
        insertSeen.run(sid, sym, now - 86_400_000);
      }
    }
  }
});
const t0 = performance.now();
build();
const buildMs = performance.now() - t0;

const rows = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
console.log(`  built in ${(buildMs / 1000).toFixed(1)}s`);
console.log(`  sessions ${rows("sessions").toLocaleString()}  ·  lists ${rows("watchlists").toLocaleString()}  ·  items ${rows("watchlist_items").toLocaleString()}  ·  seen ${rows("seen_state").toLocaleString()}`);
console.log(`  file ${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`);

/** The query behind every page load, and the one that must not degrade. */
const HOT = `
  SELECT w.symbol, s.name, s.sector, w.added_at, w.intent, l.id, l.name,
         COALESCE(v.last_seen_at, w.added_at) AS lastSeenAt
    FROM watchlist_items w
    JOIN symbols s     ON s.symbol = w.symbol
    JOIN watchlists l  ON l.id = w.list_id
LEFT JOIN seen_state v ON v.session_id = w.session_id AND v.symbol = w.symbol
   WHERE w.session_id = ?
ORDER BY l.created_at ASC, w.added_at ASC`;

console.log("\nhow SQLite plans the page-load query:");
const plan = db.prepare(`EXPLAIN QUERY PLAN ${HOT}`).all(probeSession) as Array<{ detail: string }>;
let scans = 0;
for (const p of plan) {
  const bad = /SCAN/.test(p.detail) && !/USING/.test(p.detail);
  if (bad) scans++;
  console.log(`  ${bad ? "!!" : "  "} ${p.detail}`);
}

const timeIt = (label: string, fn: () => unknown, n = 200) => {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    fn();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  console.log(`  ${label.padEnd(34)} median ${times[n / 2]!.toFixed(3)} ms   p95 ${times[Math.floor(n * 0.95)]!.toFixed(3)} ms`);
};

console.log("\ntimings against the full table:");
const hot = db.prepare(HOT);
timeIt("page load (all lists)", () => hot.all(probeSession));

const listsQ = db.prepare(
  `SELECT l.id, l.name, l.created_at, COUNT(w.symbol) AS count
     FROM watchlists l LEFT JOIN watchlist_items w ON w.list_id = l.id
    WHERE l.session_id = ? GROUP BY l.id ORDER BY l.created_at ASC`,
);
timeIt("list sidebar with counts", () => listsQ.all(probeSession));

const ackQ = db.prepare(
  `INSERT INTO seen_state (session_id, symbol, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(session_id, symbol) DO UPDATE
       SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
);
timeIt("acknowledge one symbol", () => ackQ.run(probeSession, "INFY.NS", Date.now()));

const searchQ = db.prepare(
  `SELECT symbol, name, sector FROM symbols
    WHERE sector != 'Index' AND (LOWER(symbol) LIKE ? OR LOWER(name) LIKE ?)
    ORDER BY LENGTH(name) ASC LIMIT 8`,
);
timeIt("symbol search", () => searchQ.all("%bank%", "%bank%"));

console.log(
  `\n  unindexed scans in the hot path: ${scans}${scans === 0 ? "  (every join hits an index)" : "  <-- needs an index"}`,
);

db.close();
rmSync(dir, { recursive: true, force: true });
console.log();
