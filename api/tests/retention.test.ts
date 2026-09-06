/**
 * Retention: deleting the abandoned without touching the active.
 *
 * This is a DELETE that runs unattended against real watchlists, so the tests
 * that matter are the ones proving what it spares. Driving it off last activity
 * rather than creation date is the whole safety property — an old session
 * someone still opens weekly must survive forever.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/db/store.ts";

const DAY = 86_400_000;
const NINETY = 90 * DAY;

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "meanwhile-sweep-"));
  const path = join(dir, "s.db");
  return {
    path,
    store: new Store(path),
    done(store: Store) {
      store.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may hold the WAL sidecar; the OS reclaims it.
      }
    },
  };
}

/**
 * Ages a session by writing the column directly.
 *
 * touchSession deliberately refuses to move activity backwards, so simulating
 * an absence has to go around it rather than through it.
 */
function abandon(path: string, id: string, ago: number): void {
  const db = new Database(path);
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now() - ago, id);
  db.close();
}

test("a session nobody returned to is removed", () => {
  const { path, store, done } = fresh();
  const id = store.createSession();
  abandon(path, id, 200 * DAY);

  assert.equal(store.sweepStaleSessions(NINETY), 1);
  assert.equal(store.sessionExists(id), false);
  done(store);
});

test("an old session still being used survives", () => {
  const { store, done } = fresh();
  const id = store.createSession();
  // Created long ago, opened this morning: age is not the criterion, use is.
  store.touchSession(id, Date.now());

  assert.equal(store.sweepStaleSessions(NINETY), 0);
  assert.equal(store.sessionExists(id), true);
  done(store);
});

test("touching a session cannot move its activity backwards", () => {
  const { store, done } = fresh();
  const id = store.createSession();
  const now = Date.now();

  store.touchSession(id, now);
  store.touchSession(id, now - 300 * DAY);

  assert.equal(store.sweepStaleSessions(NINETY), 0, "the stale write was ignored");
  done(store);
});
test("removing a session takes its lists, items and seen-state with it", () => {
  const { path, store, done } = fresh();
  const id = store.createSession();
  const list = store.createList(id, "Banking")!;
  store.addToWatchlist(id, "INFY.NS", list.id);
  store.acknowledge(id, "INFY.NS", Date.now());
  abandon(path, id, 200 * DAY);

  store.sweepStaleSessions(NINETY);
  store.close();

  // Checked against the file rather than the API, since orphaned rows would
  // still be invisible through a store that always filters by session.
  const db = new Database(path);
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  assert.equal(count("watchlists"), 0, "no orphaned lists");
  assert.equal(count("watchlist_items"), 0, "no orphaned items");
  assert.equal(count("seen_state"), 0, "no orphaned seen-state");
  db.close();

  done(store);
});

test("one person's abandonment does not touch anyone else", () => {
  const { path, store, done } = fresh();
  const gone = store.createSession();
  const staying = store.createSession();
  abandon(path, gone, 200 * DAY);
  store.touchSession(staying, Date.now());

  assert.equal(store.sweepStaleSessions(NINETY), 1);
  assert.equal(store.sessionExists(staying), true);
  assert.ok(store.getWatchlist(staying).length > 0, "their watchlist is intact");
  done(store);
});

test("sessions upgraded from before the column are dated, not deleted", () => {
  const { path, store, done } = fresh();
  const id = store.createSession();
  store.close();

  // Reproduce the pre-retention shape: drop the column the migration adds.
  const db = new Database(path);
  db.exec("ALTER TABLE sessions DROP COLUMN last_seen_at");
  db.close();

  const upgraded = new Store(path);
  assert.equal(upgraded.sessionExists(id), true);
  assert.equal(
    upgraded.sweepStaleSessions(NINETY),
    0,
    "backfilled from created_at, so a fresh session is not immediately eligible",
  );
  done(upgraded);
});

test("forgetting leaves nothing behind", () => {
  const { store, done } = fresh();
  const id = store.createSession();
  const list = store.createList(id, "Temporary")!;
  store.addToWatchlist(id, "INFY.NS", list.id);
  store.acknowledge(id, "INFY.NS", Date.now());

  store.forget(id);

  assert.equal(store.sessionExists(id), false);
  assert.equal(store.getLists(id).length, 0, "lists went with it");
  assert.equal(store.getWatchlist(id).length, 0, "so did the memberships");
  done(store);
});

test("forgetting one person leaves everyone else alone", () => {
  const { store, done } = fresh();
  const mine = store.createSession();
  const theirs = store.createSession();
  const before = store.getWatchlist(theirs).length;

  store.forget(mine);

  assert.equal(store.sessionExists(theirs), true);
  assert.equal(store.getWatchlist(theirs).length, before);
  done(store);
});
