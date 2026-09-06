/**
 * What the briefing says when the price feed will not answer.
 *
 * With nothing priced, nothing clears the threshold, and the natural result is
 * an all-clear — an app confidently reporting calm markets while blind. These
 * pin the distinction between "nothing happened" and "I could not look", which
 * is the one thing this product cannot get wrong and still mean anything.
 */
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Briefing } from "../../shared/types.ts";
import { Store } from "../src/db/store.ts";
import { QuoteCache } from "../src/ingestion/cache.ts";
import type { PriceSource, SymbolData } from "../src/ingestion/types.ts";
import { briefingRoutes } from "../src/routes/briefing.ts";

/** Upstream that is reachable for some symbols and refuses for others. */
function source(answers: (symbol: string) => SymbolData | null): PriceSource {
  return {
    name: "test",
    async fetch(symbol: string) {
      const data = answers(symbol);
      if (!data) throw new Error("HTTP 429");
      return data;
    },
    async fetchMany(symbols: string[]) {
      const out = new Map<string, SymbolData>();
      for (const s of symbols) {
        const d = answers(s);
        if (d) out.set(s, d);
      }
      return out;
    },
  };
}

function quoteFor(symbol: string): SymbolData {
  const now = Date.now();
  const bars = Array.from({ length: 60 }, (_, i) => ({
    date: now - (60 - i) * 86_400_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100 + (i % 2),
    adjClose: 100 + (i % 2),
    volume: 1_000,
  }));
  return {
    quote: {
      symbol,
      price: 101,
      previousClose: 100,
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

async function briefingWith(answers: (symbol: string) => SymbolData | null) {
  const dir = mkdtempSync(join(tmpdir(), "meanwhile-blind-"));
  const store = new Store(join(dir, "t.db"));
  const sessionId = store.createSession();

  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { sessionId: string }).sessionId = sessionId;
    next();
  });
  app.use("/api", briefingRoutes(store, new QuoteCache(source(answers))));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const body = (await (await fetch(`http://127.0.0.1:${port}/api/briefing`)).json()) as Briefing;

  server.close();
  store.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may still hold the WAL sidecar; the OS reclaims it.
  }
  return body;
}

test("a total feed outage is reported as unchecked, not as all-clear", async () => {
  const b = await briefingWith(() => null);
  assert.equal(b.symbolsChecked, 0, "nothing could be priced");
  assert.ok(b.symbolsTotal > 0, "but symbols were asked for");
  assert.equal(b.cards.length, 0);
  // The UI keys off exactly this pair, so an all-clear is impossible to render.
  assert.notEqual(
    b.symbolsChecked,
    b.symbolsTotal,
    "checked must not equal total, or this reads as a genuine quiet day",
  );
});

test("a partial outage still reports the full denominator", async () => {
  let served = 0;
  const b = await briefingWith((symbol) => {
    if (served >= 3) return null;
    served++;
    return quoteFor(symbol);
  });

  assert.equal(b.symbolsChecked, 3);
  assert.ok(b.symbolsTotal > 3, "the symbols it could not price are still counted");
});

test("a healthy feed reports full coverage", async () => {
  const b = await briefingWith((symbol) => quoteFor(symbol));
  assert.equal(b.symbolsChecked, b.symbolsTotal);
  assert.ok(b.symbolsTotal > 0);
});
