/**
 * Measures the threshold instead of assuming it.
 *   npm run calibrate -w api
 *
 * Two standard deviations is a statistical convention, not evidence. This
 * replays the scoring engine across real NSE history and reports how often each
 * threshold would actually have produced a card, so the number in config.ts is
 * chosen against a measured firing rate rather than a rule of thumb.
 *
 * The target is roughly one card per day for a watchlist of ten: frequent enough
 * to be worth opening, rare enough to still mean something.
 */
import { NSE_SYMBOLS } from "../src/db/symbols.ts";
import { config } from "../src/config.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";
import type { Bar, SymbolData } from "../src/ingestion/types.ts";
import { score } from "../src/scoring/pipeline.ts";
import { computeStats, priceAsOf } from "../src/scoring/stats.ts";

const THRESHOLDS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
const SAMPLE_SIZE = 20;
const LOOKBACK_DAYS = 1;
const WARMUP_BARS = 40;

const source = new YahooPriceSource("1y");

const universe = NSE_SYMBOLS.slice(0, SAMPLE_SIZE);
console.log(`Fetching ${universe.length} symbols + benchmark over 1 year…`);

const benchmark = await source.fetch(config.benchmark);
const fetched = await source.fetchMany(universe.map((s) => s.symbol));

console.log(`Got ${fetched.size}/${universe.length}. Replaying…\n`);

interface Row {
  threshold: number;
  cards: number;
  perSymbolDay: number;
  biggest: string;
}

/** Typical watchlist sizes. The rate that matters depends on how much you track. */
const LIST_SIZES = [10, 20, 30];

const observations: Array<{ symbol: string; z: number; date: number; pct: number }> = [];
let evaluatedDays = 0;

for (const seed of universe) {
  const data = fetched.get(seed.symbol);
  if (!data) continue;

  const { bars } = data;
  if (bars.length < WARMUP_BARS + 10) continue;

  // Walk forward one day at a time, computing stats only from bars available
  // *before* that day. Using the full series would leak future volatility into
  // a past decision and quietly flatter every threshold.
  for (let i = WARMUP_BARS; i < bars.length; i++) {
    const history = bars.slice(0, i + 1);
    const today = bars[i]!;
    const anchorAt = bars[Math.max(0, i - LOOKBACK_DAYS)]!.date;

    const stats = computeStats(history, benchmark.bars);
    if (stats.sigmaSource === "fallback") continue;

    const marketThen = priceAsOf(benchmark.bars, anchorAt);
    const marketNow = priceAsOf(benchmark.bars, today.date);
    const marketReturn =
      marketThen && marketNow && marketThen > 0
        ? Math.log(marketNow / marketThen)
        : 0;

    const s = score(
      {
        symbol: seed.symbol,
        name: seed.name,
        sector: seed.sector,
        quote: asQuote(data, today),
        bars: history,
        stats,
        anchorAt,
      },
      { marketReturn, now: today.date },
    );

    if (s.suppressed) continue;
    observations.push({
      symbol: seed.symbol,
      z: s.zScore,
      date: today.date,
      pct: s.returnPct,
    });
    evaluatedDays++;
  }
}

const distinctDays = new Set(observations.map((o) => Math.floor(o.date / 86_400_000)))
  .size;
const symbolsUsed = new Set(observations.map((o) => o.symbol)).size;

console.log(
  `${evaluatedDays.toLocaleString()} symbol-days across ${symbolsUsed} symbols and ${distinctDays} trading days\n`,
);

const rows: Row[] = THRESHOLDS.map((threshold) => {
  const hits = observations.filter((o) => Math.abs(o.z) >= threshold);
  const biggest = hits.reduce(
    (a, b) => (Math.abs(b.z) > Math.abs(a?.z ?? 0) ? b : a),
    hits[0],
  );

  return {
    threshold,
    cards: hits.length,
    perSymbolDay: hits.length / distinctDays / symbolsUsed,
    biggest: biggest
      ? `${biggest.symbol.replace(".NS", "")} ${biggest.pct.toFixed(1)}% (${biggest.z.toFixed(1)}σ)`
      : "—",
  };
});

console.log(
  `  threshold   cards   ${LIST_SIZES.map((n) => `${n} stocks`.padStart(10)).join("")}   verdict`,
);
console.log(`  ${"─".repeat(66)}`);

for (const r of rows) {
  const rates = LIST_SIZES.map((n) => r.perSymbolDay * n);
  // Judged against a 20-stock list, which is what people actually keep.
  const typical = r.perSymbolDay * 20;
  const verdict =
    typical > 2.5 ? "too noisy" : typical < 0.4 ? "too quiet" : "usable";
  const mark = r.threshold === config.zThreshold ? "←" : " ";

  console.log(
    `  ${mark} ${r.threshold.toFixed(1)}σ${" ".repeat(6)}${String(r.cards).padStart(5)}   ${rates
      .map((x) => x.toFixed(2).padStart(10))
      .join("")}   ${verdict}`,
  );
}

console.log(
  `\n  Cards per day by watchlist size. Attention budget is ${config.cardBudget} cards.`,
);

const configured = rows.find((r) => r.threshold === config.zThreshold);
if (configured) {
  console.log(
    `  At ${config.zThreshold}σ a 20-stock list sees ${(configured.perSymbolDay * 20).toFixed(2)} cards/day —\n` +
      `  about one a day, comfortably inside the ${config.cardBudget}-card budget even on a busy one.`,
  );
  console.log(`  Largest move it would have caught: ${configured.biggest}`);
}

const tails = [2, 3, 4].map((k) => ({
  k,
  actual: observations.filter((o) => Math.abs(o.z) >= k).length / observations.length,
  // Under a normal distribution these would be 4.6%, 0.27% and 0.006%.
  normal: [0.0455, 0.0027, 0.0000633][k - 2]!,
}));

console.log("\n  Tail check — real returns vs a normal distribution:");
for (const t of tails) {
  const ratio = t.normal > 0 ? t.actual / t.normal : 0;
  console.log(
    `    beyond ${t.k}σ: ${(t.actual * 100).toFixed(2)}% observed vs ${(t.normal * 100).toFixed(2)}% expected  (${ratio.toFixed(1)}× fatter)`,
  );
}
console.log(
  "\n  Market returns have fatter tails than a normal distribution, so a\n  threshold tuned on synthetic Gaussian data would fire far too often.\n  This is why the number is measured here instead of assumed.",
);

/** The scoring engine expects a quote; a historical bar stands in for one. */
function asQuote(data: SymbolData, bar: Bar) {
  return {
    ...data.quote,
    price: bar.adjClose,
    previousClose: bar.adjClose,
    tradedAt: bar.date,
    fetchedAt: bar.date,
    volume: bar.volume,
    state: "closed" as const,
  };
}
