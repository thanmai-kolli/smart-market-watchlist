/**
 * The upgrade path for a database written before lists existed.
 *
 * This is the one change in the product that can destroy data a user typed in,
 * and it runs automatically on startup, so it is tested against a database
 * built in the old shape rather than trusted.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/db/store.ts";

const OLD_SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, sync_code TEXT UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE symbols (
  symbol TEXT PRIMARY KEY, name TEXT NOT NULL, sector TEXT NOT NULL
);
CREATE TABLE watchlist_items (
  session_id TEXT NOT NULL, symbol TEXT NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, symbol)
);
CREATE TABLE seen_state (
  session_id TEXT NOT NULL, symbol TEXT NOT NULL, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, symbol)
);
`;

/**
 * Windows can still hold the WAL sidecar for a moment after close, and a temp
 * directory that outlives the run is not a failure of anything under test.
 */
function cleanup(target: string): void {
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    // Left for the OS to reclaim.
  }
}

/** A database as the previous release would have left it. */
function legacyDb(): { path: string; dir: string; sessions: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "meanwhile-"));
  const path = join(dir, "old.db");
  const db = new Database(path);
  db.exec(OLD_SCHEMA);

  const sessions = ["session-a", "session-b"];
  for (const id of sessions) {
    db.prepare("INSERT INTO sessions (id, created_at) VALUES (?, ?)").run(id, 1);
  }
  db.prepare("INSERT INTO symbols VALUES ('INFY.NS', 'Infosys', 'IT')").run();
  db.prepare("INSERT INTO symbols VALUES ('TCS.NS', 'TCS', 'IT')").run();

  const add = db.prepare(
    "INSERT INTO watchlist_items (session_id, symbol, added_at) VALUES (?, ?, ?)",
  );
  add.run("session-a", "INFY.NS", 111);
  add.run("session-a", "TCS.NS", 222);
  add.run("session-b", "INFY.NS", 333);

  db.prepare(
    "INSERT INTO seen_state (session_id, symbol, last_seen_at) VALUES (?, ?, ?)",
  ).run("session-a", "INFY.NS", 999);

  db.close();
  return { path, dir, sessions };
}

test("every pre-lists session keeps its symbols, in one list of its own", () => {
  const { path, dir } = legacyDb();
  try {
    const store = new Store(path);

    const a = store.getWatchlist("session-a");
    assert.deepEqual(
      a.map((r) => r.symbol).sort(),
      ["INFY.NS", "TCS.NS"],
      "session-a kept both symbols",
    );
    assert.equal(new Set(a.map((r) => r.listId)).size, 1, "gathered into one list");

    const b = store.getWatchlist("session-b");
    assert.equal(b.length, 1);
    assert.notEqual(a[0]!.listId, b[0]!.listId, "sessions do not share a list");

    store.close();
  } finally {
    cleanup(dir);
  }
});

test("acknowledgements survive the upgrade", () => {
  const { path, dir } = legacyDb();
  try {
    const store = new Store(path);
    const infy = store.getWatchlist("session-a").find((r) => r.symbol === "INFY.NS");
    assert.equal(infy?.lastSeenAt, 999, "the anchor was not reset to added_at");
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("added_at survives, so nothing looks newly added", () => {
  const { path, dir } = legacyDb();
  try {
    const store = new Store(path);
    const tcs = store.getWatchlist("session-a").find((r) => r.symbol === "TCS.NS");
    assert.equal(tcs?.addedAt, 222);
    assert.equal(tcs?.intent, "none", "everything starts without a stated position");
    store.close();
  } finally {
    cleanup(dir);
  }
});

test("running twice changes nothing the second time", () => {
  const { path, dir } = legacyDb();
  try {
    const first = new Store(path);
    const before = first.getWatchlist("session-a");
    first.close();

    const second = new Store(path);
    const after = second.getWatchlist("session-a");
    second.close();

    assert.deepEqual(after, before, "the migration is idempotent");
  } finally {
    cleanup(dir);
  }
});

test("a symbol can sit in two lists but is acknowledged once", () => {
  const dir = mkdtempSync(join(tmpdir(), "meanwhile-"));
  try {
    const store = new Store(join(dir, "fresh.db"));
    const session = store.createSession();
    const second = store.createList(session, "Banking");
    assert.ok(second);

    store.addToWatchlist(session, "INFY.NS", second.id);
    const rows = store.getWatchlist(session).filter((r) => r.symbol === "INFY.NS");
    assert.equal(rows.length, 2, "membership is per list");

    // Later than the seeded anchor: the write is deliberately monotone, so an
    // older timestamp would be ignored rather than move the baseline backwards.
    const ackAt = Date.now();
    store.acknowledge(session, "INFY.NS", ackAt);
    const seen = store
      .getWatchlist(session)
      .filter((r) => r.symbol === "INFY.NS")
      .map((r) => r.lastSeenAt);
    assert.deepEqual(seen, [ackAt, ackAt], "seen-state is per symbol, not per list");

    store.close();
  } finally {
    cleanup(dir);
  }
});

test("removing from one list leaves the symbol, and its history, in the other", () => {
  const dir = mkdtempSync(join(tmpdir(), "meanwhile-"));
  try {
    const store = new Store(join(dir, "fresh.db"));
    const session = store.createSession();
    const banking = store.createList(session, "Banking")!;
    store.addToWatchlist(session, "INFY.NS", banking.id);
    const ackAt = Date.now();
    store.acknowledge(session, "INFY.NS", ackAt);

    store.removeFromWatchlist(session, "INFY.NS", banking.id);
    const left = store.getWatchlist(session).filter((r) => r.symbol === "INFY.NS");
    assert.equal(left.length, 1, "still in the original list");
    assert.equal(left[0]!.lastSeenAt, ackAt, "and still acknowledged");

    store.close();
  } finally {
    cleanup(dir);
  }
});

test("the last list cannot be deleted, so there is always somewhere to add", () => {
  const dir = mkdtempSync(join(tmpdir(), "meanwhile-"));
  try {
    const store = new Store(join(dir, "fresh.db"));
    const session = store.createSession();
    const only = store.getLists(session);
    assert.equal(only.length, 1);
    assert.equal(store.deleteList(session, only[0]!.id), false);

    const extra = store.createList(session, "Pharma")!;
    assert.equal(store.deleteList(session, extra.id), true);
    store.close();
  } finally {
    cleanup(dir);
  }
});
