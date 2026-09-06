/**
 * The promise not to repeat itself.
 *
 * Principle five is stated on the page: once you have been told about a move,
 * you will not be told again. Widening quietly broke it — when nothing cleared
 * the bar the ladder rescored every symbol from one shared anchor, ignoring what
 * had already been acknowledged, and handed back the card just dismissed.
 */
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Briefing } from "../../shared/types.ts";
import { Store } from "../src/db/store.ts";
import { QuoteCache } from "../src/ingestion/cache.ts";
import type { PriceSource, SymbolData } from "../src/ingestion/types.ts";
import { briefingRoutes } from "../src/routes/briefing.ts";

const DAY = 86_400_000;

/**
 * A drift that happened between 90 and 50 days ago, then nothing.
 *
 * Recent windows see a flat line, so only the widest rung of the ladder finds
 * anything — which is the situation the bug lived in. A gradual drift rather
 * than one jump, because a single step inflates the volatility as much as the
 * return and the z-score barely moves.
 */
function series(flat: boolean): SymbolData {
  const now = Date.now();
  const priceAt = (i: number): number => {
    if (flat) return 100;
    if (i < 50) return 100;
    if (i < 90) return 100 * Math.pow(1.005, i - 50);
    return 100 * Math.pow(1.005, 40);
  };

  const bars = Array.from({ length: 140 }, (_, i) => {
    const close = priceAt(i);
    return {
      date: now - (140 - i) * DAY,
      open: close,
      high: close,
      low: close,
      close,
      adjClose: close,
      volume: 1_000,
    };
  });

  const last = priceAt(139);
  return {
    quote: {
      symbol: "TEST",
      price: last,
      previousClose: last,
      tradedAt: now,
      fetchedAt: now,
      currency: "INR",
      exchange: "test",
      state: "closed",
      source: "test",
      dayHigh: null,
      dayLow: null,
      volume: 1_000,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      session: null,
    },
    bars,
  };
}

// The benchmark stays flat, or the same drift would appear in every symbol and
// cancel out as "the whole market did that".
const forSymbol = (symbol: string): SymbolData => series(symbol.startsWith("^"));

const source: PriceSource = {
  name: "test",
  async fetch(symbol: string) {
    return forSymbol(symbol);
  },
  async fetchMany(symbols: string[]) {
    return new Map(symbols.map((s) => [s, forSymbol(s)]));
  },
};

const dir = mkdtempSync(join(tmpdir(), "meanwhile-ack-"));
const store = new Store(join(dir, "a.db"));
const sessionId = store.createSession();

const app = express();
app.use((req, _res, next) => {
  (req as express.Request & { sessionId: string }).sessionId = sessionId;
  next();
});
app.use("/api", briefingRoutes(store, new QuoteCache(source)));

const server = app.listen(0);
const port = (server.address() as { port: number }).port;

after(() => {
  server.close();
  store.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL sidecar; the OS reclaims it.
  }
});

const briefing = async (): Promise<Briefing> =>
  (await (await fetch(`http://127.0.0.1:${port}/api/briefing`)).json()) as Briefing;

test("acknowledging a card keeps it from coming back through widening", async () => {
  const first = await briefing();
  assert.ok(first.cards.length > 0, "something surfaced to acknowledge");
  assert.ok(first.widenedFrom, "and it took a wider window to find it");

  for (const card of first.cards) {
    store.acknowledge(sessionId, card.symbol, Date.now());
  }

  const second = await briefing();
  const repeated = second.cards.filter((c) =>
    first.cards.some((f) => f.symbol === c.symbol),
  );
  assert.deepEqual(repeated, [], "nothing acknowledged is offered a second time");
});

test("acknowledging one symbol does not silence the others", async () => {
  const store2 = new Store(join(dir, "b.db"));
  const session2 = store2.createSession();

  const rows = store2.getWatchlist(session2);
  assert.ok(rows.length > 1);
  store2.acknowledge(session2, rows[0]!.symbol, Date.now());

  const seen = store2.getWatchlist(session2);
  const acked = seen.find((r) => r.symbol === rows[0]!.symbol)!;
  const untouched = seen.filter((r) => r.symbol !== rows[0]!.symbol);

  assert.ok(
    untouched.every((r) => r.lastSeenAt < acked.lastSeenAt),
    "only the acknowledged symbol moved forward",
  );
  store2.close();
});
