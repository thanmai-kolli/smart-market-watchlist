/**
 * Does the seeded universe actually exercise every card the product claims?
 *
 * A scoring engine that has never fired half its branches on real data is a
 * claim, not a feature. This walks the whole seed list over several windows and
 * reports which kinds are reachable right now.
 */
import { QuoteCache } from "../src/ingestion/cache.ts";
import { getCorporateActions } from "../src/ingestion/nse.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";
import { BENCHMARK, NSE_SYMBOLS } from "../src/db/symbols.ts";
import { computeStats, priceAsOf, tradingDaysBetween } from "../src/scoring/stats.ts";

const DAY = 86_400_000;
const WINDOWS = [1, 3, 7, 30, 90];

const cache = new QuoteCache(new YahooPriceSource());
const symbols = NSE_SYMBOLS.map((s) => s.symbol);
const now = Date.now();

const all = await cache.getMany([...symbols, BENCHMARK.symbol]);
const market = all.get(BENCHMARK.symbol) ?? null;
console.log(`priced ${all.size - (market ? 1 : 0)} of ${symbols.length} symbols\n`);

const best = new Map<number, { symbol: string; z: number }>();
let nearLevel = 0;
let missing = 0;

for (const s of NSE_SYMBOLS) {
  const data = all.get(s.symbol);
  if (!data) {
    missing++;
    continue;
  }

  const { quote, bars } = data;
  const stats = computeStats(bars, market?.bars ?? []);

  const hi = quote.fiftyTwoWeekHigh;
  const lo = quote.fiftyTwoWeekLow;
  if (
    (hi != null && quote.price >= hi * 0.98) ||
    (lo != null && quote.price <= lo * 1.02)
  ) {
    nearLevel++;
  }

  for (const days of WINDOWS) {
    const at = now - days * DAY;
    const then = priceAsOf(bars, at);
    if (then == null) continue;

    const elapsed = Math.max(1, tradingDaysBetween(bars, at, now));
    const r = (quote.price - then) / then;
    const mThen = market ? priceAsOf(market.bars, at) : null;
    const mr = mThen != null && market ? (market.quote.price - mThen) / mThen : 0;
    const z = (r - stats.beta * mr) / (stats.dailySigma * Math.sqrt(elapsed));

    const cur = best.get(days);
    if (!cur || Math.abs(z) > Math.abs(cur.z)) best.set(days, { symbol: s.symbol, z });
  }
}

console.log("largest move in the universe, by window:");
for (const days of WINDOWS) {
  const b = best.get(days);
  if (!b) continue;
  const fires = Math.abs(b.z) >= 2 ? "  <-- would fire a move card" : "";
  console.log(
    `  ${String(days).padStart(3)}d   ${b.symbol.replace(".NS", "").padEnd(12)} ${b.z.toFixed(2).padStart(6)}σ${fires}`,
  );
}

const withActions: string[] = [];
for (const s of NSE_SYMBOLS) {
  const list = await getCorporateActions(s.symbol);
  if (list && list.length > 0) {
    withActions.push(`${s.symbol.replace(".NS", "").padEnd(12)} ${list[0]!.kind.padEnd(9)} ${list[0]!.subject.slice(0, 44)}`);
  }
}
console.log(`\ncorporate actions found: ${withActions.length} of ${NSE_SYMBOLS.length} symbols`);
for (const line of withActions.slice(0, 10)) console.log(`  ${line}`);

console.log(`\nnear a 52-week level: ${nearLevel} symbols`);
console.log(`unpriced: ${missing}`);
