/**
 * One database, many strangers.
 *
 * Every row a person owns is reached through their session id, so isolation is
 * not a feature layered on top — it is the shape of every query. These tests try
 * to reach across that boundary on purpose, because "the WHERE clause looks
 * right" is not evidence, and this is the failure that would matter most.
 */
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { WatchlistResponse } from "../../shared/types.ts";
import { Store } from "../src/db/store.ts";
import { QuoteCache } from "../src/ingestion/cache.ts";
import type { PriceSource } from "../src/ingestion/types.ts";
import { watchlistRoutes } from "../src/routes/watchlist.ts";

/** No network in a test: every symbol simply has no price. */
const noPrices: PriceSource = {
  name: "none",
  async fetch() {
    throw new Error("offline");
  },
  async fetchMany() {
    return new Map();
  },
};

const dir = mkdtempSync(join(tmpdir(), "meanwhile-tenant-"));
const store = new Store(join(dir, "t.db"));

const alice = store.createSession();
const mallory = store.createSession();

const app = express();
app.use(express.json());
// The caller names itself; the routes must still refuse to serve anyone else's rows.
app.use((req, _res, next) => {
  (req as express.Request & { sessionId: string }).sessionId =
    req.header("x-session") === "mallory" ? mallory : alice;
  next();
});
app.use("/api", watchlistRoutes(store, new QuoteCache(noPrices)));

const server = app.listen(0);
const port = (server.address() as { port: number }).port;

after(() => {
  server.close();
  store.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL sidecar briefly; the OS reclaims it.
  }
});

const as = async (who: "alice" | "mallory", path: string, init: RequestInit = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-session": who, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as WatchlistResponse };
};

/** Alice keeps a private list; Mallory learns its id and tries to use it. */
const aliceList = store.createList(alice, "Alice private")!;
store.addToWatchlist(alice, "INFY.NS", aliceList.id);

test("a stranger cannot read another session's list", async () => {
  const { body } = await as("mallory", `/api/watchlist?list=${aliceList.id}`);
  const leaked = body.items.filter((i) => i.listId === aliceList.id);
  assert.equal(leaked.length, 0, "no rows from Alice's list");
  assert.ok(
    body.lists.every((l) => l.id !== aliceList.id),
    "and it is not even named in the sidebar",
  );
});

test("a stranger cannot delete another session's list", async () => {
  const { status } = await as("mallory", `/api/lists?list=${aliceList.id}`, { method: "DELETE" });
  assert.notEqual(status, 200);
  assert.ok(
    store.getLists(alice).some((l) => l.id === aliceList.id),
    "Alice still has her list",
  );
});

test("a stranger cannot rename another session's list", async () => {
  const { status } = await as("mallory", "/api/lists", {
    method: "PATCH",
    body: JSON.stringify({ list: aliceList.id, name: "owned" }),
  });
  assert.equal(status, 404);
  assert.equal(store.getLists(alice).find((l) => l.id === aliceList.id)?.name, "Alice private");
});

test("a stranger cannot set intent inside another session's list", async () => {
  const { status } = await as("mallory", "/api/intent", {
    method: "POST",
    body: JSON.stringify({ symbol: "INFY.NS", list: aliceList.id, intent: "hold" }),
  });
  assert.equal(status, 404);
  const row = store.getWatchlist(alice).find((r) => r.listId === aliceList.id);
  assert.equal(row?.intent, "none");
});

test("adding to a list you do not own lands in your own, not theirs", async () => {
  const before = store.getWatchlist(alice).filter((r) => r.listId === aliceList.id).length;
  await as("mallory", "/api/watchlist", {
    method: "POST",
    body: JSON.stringify({ symbol: "TCS.NS", list: aliceList.id }),
  });

  const after = store.getWatchlist(alice).filter((r) => r.listId === aliceList.id).length;
  assert.equal(after, before, "Alice's list is untouched");
  assert.ok(
    store.getWatchlist(mallory).some((r) => r.symbol === "TCS.NS"),
    "and Mallory got it in her own default list",
  );
});

test("a stranger cannot remove a symbol from another session's list", async () => {
  await as("mallory", `/api/watchlist?symbol=INFY.NS&list=${aliceList.id}`, { method: "DELETE" });
  assert.ok(
    store.getWatchlist(alice).some((r) => r.listId === aliceList.id && r.symbol === "INFY.NS"),
    "INFY is still in Alice's list",
  );
});

test("acknowledging is scoped to the person who did it", async () => {
  const at = Date.now() + 60_000;
  store.acknowledge(mallory, "INFY.NS", at);

  const aliceRow = store.getWatchlist(alice).find((r) => r.symbol === "INFY.NS");
  assert.notEqual(aliceRow?.lastSeenAt, at, "Alice's reference point did not move");
});

test("two sessions seeded from the same demo list stay independent", async () => {
  const before = store.getWatchlist(alice).length;
  store.removeFromWatchlist(mallory, "RELIANCE.NS");
  assert.equal(store.getWatchlist(alice).length, before, "Alice keeps hers");
});
