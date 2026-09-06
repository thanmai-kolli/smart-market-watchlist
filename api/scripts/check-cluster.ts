/**
 * Has the cluster card ever had a real chance to fire?
 *
 * It is tested against synthetic data, but "five sector stocks moving together"
 * is not something a feed produces on demand, so it has never been observed on
 * live prices. This sweeps the whole universe across every anchor the app uses
 * and reports whether the condition occurs in practice.
 */
import { config } from "../src/config.ts";
import { BENCHMARK, NSE_SYMBOLS } from "../src/db/symbols.ts";
import { QuoteCache } from "../src/ingestion/cache.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";
import { score, type Candidate } from "../src/scoring/pipeline.ts";
import { rank } from "../src/scoring/rank.ts";
import { computeStats, priceAsOf } from "../src/scoring/stats.ts";

const cache = new QuoteCache(new YahooPriceSource(undefined, 20000));
const now = Date.now();
const DAY = 86_400_000;

const symbols = NSE_SYMBOLS.map((s) => s.symbol);
const meta = new Map(NSE_SYMBOLS.map((s) => [s.symbol, s]));

console.log(`sweeping ${symbols.length} symbols for a real sector cluster\n`);

const data = await cache.getMany(symbols);
const benchmark = await cache.get(BENCHMARK.symbol);

let found = 0;

for (const days of [1, 3, 7, 14, 30, 90]) {
  const anchorAt = now - days * DAY;

  const marketThen = benchmark ? priceAsOf(benchmark.bars, anchorAt) : null;
  const marketReturn =
    benchmark && marketThen && marketThen > 0
      ? Math.log(benchmark.quote.price / marketThen)
      : 0;

  const candidates: Candidate[] = [];
  for (const symbol of symbols) {
    const d = data.get(symbol);
    const info = meta.get(symbol);
    if (!d || !info) continue;
    candidates.push({
      symbol,
      name: info.name,
      sector: info.sector,
      quote: d.quote,
      bars: d.bars,
      stats: computeStats(d.bars, benchmark?.bars ?? []),
      anchorAt,
    });
  }

  const scored = candidates.map((c) => score(c, { marketReturn, now }));
  const { cards } = rank(scored, { threshold: config.zThreshold, budget: 3 });

  const clusters = cards.filter((c) => c.kind === "cluster");
  const movers = scored.filter(
    (s) => !s.suppressed && Math.abs(s.zScore) >= config.zThreshold,
  );

  console.log(
    `${String(days).padStart(3)}d  ${String(movers.length).padStart(3)} past ${config.zThreshold}σ`,
  );

  for (const c of clusters) {
    console.log(`      ${c.headline}`);
    console.log(
      `      members: ${[c.symbol, ...(c.members ?? [])].map((s) => s.replace(".NS", "")).join(", ")}  ·  average ${Math.abs(c.zScore).toFixed(2)}σ`,
    );
    console.log(
      `      none of them clears ${config.zThreshold}σ alone, which is the whole reason this card exists`,
    );
  }

  // Show why not, so "no cluster" is a finding rather than a shrug.
  const bySector = new Map<string, number>();
  for (const m of movers) {
    const sector = meta.get(m.symbol)?.sector ?? "?";
    bySector.set(sector, (bySector.get(sector) ?? 0) + 1);
  }
  const crowded = [...bySector.entries()].filter(([, n]) => n >= 2);
  if (crowded.length > 0 && clusters.length === 0) {
    console.log(
      `      closest: ${crowded.map(([s, n]) => `${s} ${n}`).join(", ")} (needs 3 in one sector, moving together)`,
    );
  }

  found += clusters.length;
}

console.log(
  found > 0
    ? `\ncluster observed on live data`
    : `\nno cluster in today's market -- the condition is real but rare, which is the point of it`,
);
