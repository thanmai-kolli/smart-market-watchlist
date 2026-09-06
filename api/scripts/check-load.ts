/**
 * Does "no account, and it remembers you" survive a crowd?
 *
 * The claim is only worth making if it holds when many people arrive at once, so
 * this measures the thing rather than asserting it: concurrent first-time
 * visitors, each doing what a real page load does, against the running server.
 *
 *   node --experimental-strip-types api/scripts/check-load.ts 200
 */
import Database from "better-sqlite3";
import { config } from "../src/config.ts";

const USERS = Number(process.argv[2] ?? 100);
const BASE = `http://localhost:${config.port}`;

const db = new Database(config.dbPath);
const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
const before = {
  sessions: count("sessions"),
  items: count("watchlist_items"),
  seen: count("seen_state"),
};

async function health() {
  return (await (await fetch(`${BASE}/api/health`)).json()) as {
    cache: { symbols: number; hits: number; misses: number };
  };
}

const cacheBefore = (await health()).cache;

/** One visitor: arrive, get a session, load the list and the briefing. */
async function visit(): Promise<number> {
  const started = performance.now();
  const first = await fetch(`${BASE}/api/watchlist`);
  const cookie = (first.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  await first.json();
  await (await fetch(`${BASE}/api/briefing`, { headers: { cookie } })).json();
  return performance.now() - started;
}

console.log(`\n${USERS} first-time visitors, all at once\n`);

const wall = performance.now();
const settled = await Promise.allSettled(Array.from({ length: USERS }, visit));
const wallMs = performance.now() - wall;

const times = settled
  .filter((s): s is PromiseFulfilledResult<number> => s.status === "fulfilled")
  .map((s) => s.value)
  .sort((a, b) => a - b);
const failed = settled.length - times.length;

const at = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))] ?? 0;

console.log(`  completed        ${times.length}/${USERS}${failed ? `  (${failed} failed)` : ""}`);
console.log(`  wall clock       ${(wallMs / 1000).toFixed(2)} s`);
console.log(`  throughput       ${(times.length / (wallMs / 1000)).toFixed(0)} visits/sec`);
console.log(`  median           ${at(0.5).toFixed(0)} ms`);
console.log(`  p95              ${at(0.95).toFixed(0)} ms`);
console.log(`  slowest          ${(times.at(-1) ?? 0).toFixed(0)} ms`);

const cacheAfter = (await health()).cache;
console.log(`\n  upstream fetches this run   ${cacheAfter.misses - cacheBefore.misses}`);
console.log(`  cache hits this run         ${cacheAfter.hits - cacheBefore.hits}`);
console.log(`  symbols held                ${cacheAfter.symbols}`);

const after = {
  sessions: count("sessions"),
  items: count("watchlist_items"),
  seen: count("seen_state"),
};
const rows =
  after.sessions - before.sessions + (after.items - before.items) + (after.seen - before.seen);

console.log(`\n  rows written                ${rows}  (${(rows / Math.max(1, after.sessions - before.sessions)).toFixed(0)} per visitor)`);
console.log(`  sessions now                ${after.sessions}`);

const pageSize = (db.pragma("page_size", { simple: true }) as number) ?? 4096;
const pages = (db.pragma("page_count", { simple: true }) as number) ?? 0;
const bytesPerSession = after.sessions > 0 ? (pages * pageSize) / after.sessions : 0;
console.log(`  database size               ${((pages * pageSize) / 1024).toFixed(0)} KB  (~${bytesPerSession.toFixed(0)} B/session)`);
console.log(
  `  projected at 1M sessions    ${((bytesPerSession * 1_000_000) / 1024 / 1024 / 1024).toFixed(2)} GB`,
);

db.close();
console.log();
