/**
 * The landing page has to describe the same reality as the app below it.
 *
 * The comparison used to be hard-coded, which meant the pitch kept quoting
 * Friday's prices while the live panel a screen below moved on — the precise
 * dishonesty this product exists to remove.
 */
import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";
import type { Showcase } from "../../shared/types.ts";
import { QuoteCache } from "../src/ingestion/cache.ts";
import type { PriceSource, SymbolData } from "../src/ingestion/types.ts";
import { showcaseRoutes } from "../src/routes/showcase.ts";

const DAY = 86_400_000;

/** Drifts between 90 and 50 days ago, then nothing — only the widest rung finds it. */
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
      previousClose: last * 0.999,
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

function serve(everythingFlat: boolean): express.Express {
  // A flat benchmark, or the same drift in every symbol cancels out as "the
  // whole market did that" and nothing is left to show.
  const forSymbol = (symbol: string): SymbolData =>
    series(everythingFlat || symbol.startsWith("^"));

  const source: PriceSource = {
    name: "test",
    async fetch(symbol: string) {
      return forSymbol(symbol);
    },
    async fetchMany(symbols: string[]) {
      return new Map(symbols.map((s) => [s, forSymbol(s)]));
    },
  };

  const app = express();
  app.use("/api", showcaseRoutes(new QuoteCache(source)));
  return app;
}

async function read(app: express.Express): Promise<Showcase> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/showcase`);
    assert.equal(res.status, 200);
    return (await res.json()) as Showcase;
  } finally {
    server.close();
  }
}

test("the stock being singled out is one of the stocks listed as ordinary", async () => {
  const showcase = await read(serve(false));

  assert.ok(showcase.standout, "a drift that large should be found");
  assert.ok(
    showcase.quotes.some((q) => q.symbol === showcase.standout!.symbol),
    "the punchline is that both columns describe the same company",
  );
  assert.ok(
    Math.abs(showcase.standout.zScore) >= 2,
    "nothing below the bar should ever be presented as remarkable",
  );
});

test("a genuinely quiet market produces no standout rather than a manufactured one", async () => {
  const showcase = await read(serve(true));

  assert.equal(showcase.standout, null);
  assert.ok(showcase.quotes.length > 0, "prices are still real and still shown");
});

test("the pitch can be read without being given a session", async () => {
  const server = serve(false).listen(0);
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/showcase`);
    assert.equal(res.headers.get("set-cookie"), null);
  } finally {
    server.close();
  }
});
