/**
 * The judgement, on live data, one symbol at a time.
 *
 * Unit tests prove the arithmetic is right on numbers I chose. This proves the
 * same code reaches a defensible conclusion on numbers nobody chose, which is a
 * different claim and the one that matters.
 *
 *   node --experimental-strip-types api/scripts/explain.ts RELIANCE 7
 */
import { config } from "../src/config.ts";
import { QuoteCache } from "../src/ingestion/cache.ts";
import { getCorporateActions } from "../src/ingestion/nse.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";
import { score } from "../src/scoring/pipeline.ts";
import { computeStats, priceAsOf } from "../src/scoring/stats.ts";

const input = (process.argv[2] ?? "RELIANCE").toUpperCase();
const days = Number(process.argv[3] ?? 7);
const symbol = input.startsWith("^") || input.endsWith(".NS") ? input : `${input}.NS`;

const cache = new QuoteCache(new YahooPriceSource());
const now = Date.now();
const anchorAt = now - days * 86_400_000;

const [data, benchmark] = await Promise.all([
  cache.get(symbol),
  cache.get(config.benchmark),
]);

if (!data) {
  console.log(`No data for ${symbol}.`);
  process.exit(1);
}

const stats = computeStats(data.bars, benchmark?.bars ?? []);
const actions = (await getCorporateActions(symbol)) ?? [];

const mThen = benchmark ? priceAsOf(benchmark.bars, anchorAt) : null;
const marketReturn =
  mThen != null && benchmark ? Math.log(benchmark.quote.price / mThen) : 0;

const result = score(
  { symbol, name: symbol.replace(".NS", ""), sector: "?", quote: data.quote, bars: data.bars, stats, anchorAt, actions },
  { marketReturn, now },
);

const w = result.working;
const pad = (s: string) => s.padEnd(30);
const pc = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

console.log(`\n${symbol}  ·  as if you last looked ${days} day${days === 1 ? "" : "s"} ago\n`);

console.log("1. what happened");
console.log(`   ${pad("price then")} ₹${w.priceThen.toFixed(2)}`);
console.log(`   ${pad("price now")} ₹${w.priceNow.toFixed(2)}`);
console.log(`   ${pad("raw move")} ${pc(w.returnPct)}`);

console.log("\n2. how much of it was the market");
console.log(`   ${pad("NIFTY over the same window")} ${pc(w.marketReturnPct)}`);
console.log(`   ${pad("this stock's beta")} ${w.beta}`);
console.log(`   ${pad("so the market explains")} ${pc(w.marketExplainsPct)}`);
console.log(`   ${pad("leaving, as its own news")} ${pc(w.idiosyncraticPct)}`);

console.log("\n3. is that a lot for THIS stock");
console.log(`   ${pad("its daily volatility")} ${w.dailySigmaPct}%  (${stats.sigmaSource})`);
console.log(`   ${pad("trading days elapsed")} ${w.tradingDaysElapsed}`);
console.log(`   ${pad("so an ordinary swing is")} ±${w.expectedOneSigmaPct}%`);
console.log(`   ${pad("this move, in those units")} ${w.zScore}σ`);

console.log("\n4. was anyone actually trading");
console.log(
  `   ${pad("volume vs its own normal")} ${w.relativeVolume == null ? "unknown" : w.relativeVolume + "×"}`,
);

console.log("\n5. the verdict");
if (result.suppressed) {
  console.log(`   suppressed — ${result.suppressed}`);
} else {
  const fires = Math.abs(w.zScore) >= config.zThreshold;
  console.log(`   ${pad("threshold")} ${config.zThreshold}σ  (measured, see calibrate.ts)`);
  console.log(`   ${pad("kind")} ${result.kind}`);
  console.log(`   ${pad("ranking weight")} ${result.score}`);
  console.log(`   ${pad("shown to the user?")} ${fires || result.kind !== "move" ? "YES" : "no — inside its normal range"}`);
  if (fires || result.kind !== "move") {
    console.log(`\n   "${result.headline}"`);
    for (const r of result.reasons) console.log(`     · ${r}`);
  }
}
console.log();
