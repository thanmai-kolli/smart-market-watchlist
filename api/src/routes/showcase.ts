/**
 * The landing page comparison, measured instead of written down.
 *
 * The page claims a stock can look dull today and still have moved a great deal
 * since you last looked. Hard-coding that claim would have the landing page
 * showing one price while the live app a screen below showed another — the
 * exact dishonesty this product exists to remove. So the illustration runs the
 * real scorer over real prices and describes whatever it actually finds.
 *
 * Read-only and sessionless: it never touches the store, so a visitor reading
 * the pitch is not yet a user with state.
 */
import { Router } from "express";
import type { Showcase, ShowcaseQuote, ShowcaseStandout } from "../../../shared/types.ts";
import { config } from "../config.ts";
import { DEMO_WATCHLIST, NSE_SYMBOLS } from "../db/symbols.ts";
import type { QuoteCache } from "../ingestion/cache.ts";
import type { SymbolData } from "../ingestion/types.ts";
import { score } from "../scoring/pipeline.ts";
import { computeStats, priceAsOf } from "../scoring/stats.ts";

/** How many rows the "every other watchlist" column shows. */
const COLUMN_SIZE = 4;

/**
 * Searched for the standout; the seeded eight alone are too calm to find one.
 *
 * Eight large caps can go a whole quarter without anything crossing two sigma,
 * which is a fair description of large caps and a poor demonstration of a
 * scorer. Widening the search brings in the names that actually move without
 * paying to price all forty-nine on a page most visitors only scroll past.
 */
const SHOWCASE_POOL = [
  ...DEMO_WATCHLIST,
  "DIVISLAB.NS",
  "IDEA.NS",
  "TATAPOWER.NS",
  "SBILIFE.NS",
  "ADANIPORTS.NS",
  "TRENT.NS",
  "HINDALCO.NS",
  "BAJFINANCE.NS",
];

export function showcaseRoutes(cache: QuoteCache): Router {
  const router = Router();
  const meta = new Map(NSE_SYMBOLS.map((s) => [s.symbol, s]));

  router.get("/showcase", async (_req, res) => {
    const now = Date.now();
    const [data, benchmark] = await Promise.all([
      cache.getMany(SHOWCASE_POOL),
      cache.get(config.benchmark),
    ]);

    const priced = SHOWCASE_POOL.filter((s) => data.has(s));
    if (priced.length === 0) {
      res.json({
        asOf: now,
        marketState: "unknown",
        quotes: [],
        standout: null,
      } satisfies Showcase);
      return;
    }

    const standout = findStandout(priced, data, benchmark, now, meta);

    // The punchline is that both columns describe the same company, so whatever
    // was singled out has to appear in the ordinary-looking list too.
    const familiar = DEMO_WATCHLIST.filter((s) => data.has(s) && s !== standout?.symbol);
    const column = standout ? [standout.symbol, ...familiar] : familiar;

    const quotes: ShowcaseQuote[] = column
      .slice(0, COLUMN_SIZE)
      .map((symbol) => {
        const quote = data.get(symbol)!.quote;
        return {
          symbol,
          price: quote.price,
          changePct: todayPct(quote.price, quote.previousClose),
        };
      });

    res.json({
      asOf: now,
      marketState: benchmark?.quote.state ?? "unknown",
      quotes,
      standout,
    } satisfies Showcase);
  });

  return router;
}

/**
 * The first window that turns up something worth a card.
 *
 * Walking outwards from a week mirrors what the briefing does when a visit was
 * recent and nothing has happened since, so the illustration stays a true
 * description of the product rather than a flattering one.
 */
function findStandout(
  symbols: string[],
  data: Map<string, SymbolData>,
  benchmark: SymbolData | null,
  now: number,
  meta: Map<string, { name: string; sector: string }>,
): ShowcaseStandout | null {
  for (const days of config.widenLadderDays) {
    const anchorAt = now - days * 86_400_000;
    const marketReturn = benchmarkReturn(benchmark, anchorAt);

    const best = symbols
      .map((symbol) => {
        const found = data.get(symbol)!;
        const info = meta.get(symbol);
        return score(
          {
            symbol,
            name: info?.name ?? symbol,
            sector: info?.sector ?? "Unknown",
            quote: found.quote,
            bars: found.bars,
            stats: computeStats(found.bars, benchmark?.bars ?? []),
            anchorAt,
          },
          { marketReturn, now },
        );
      })
      .filter((s) => !s.suppressed && Math.abs(s.zScore) >= config.zThreshold)
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))[0];

    if (!best) continue;

    const quote = data.get(best.symbol)!.quote;
    return {
      symbol: best.symbol,
      returnPct: best.returnPct,
      zScore: best.zScore,
      reasons: best.reasons,
      days,
      todayPct: todayPct(quote.price, quote.previousClose),
    };
  }

  return null;
}

function benchmarkReturn(benchmark: SymbolData | null, anchorAt: number): number {
  if (!benchmark) return 0;
  const then = priceAsOf(benchmark.bars, anchorAt);
  if (then == null || then <= 0) return 0;
  return Math.log(benchmark.quote.price / then);
}

function todayPct(price: number, previousClose: number | null): number | null {
  if (previousClose == null || previousClose <= 0) return null;
  return (price / previousClose - 1) * 100;
}
