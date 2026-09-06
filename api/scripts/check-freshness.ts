/**
 * Does every symbol's history reach its own quote?
 *
 * The four sector indices that reported a July close as yesterday were not
 * special: any symbol whose daily bars stop updating while its quote keeps
 * moving will do the same. This checks the whole universe for that gap, and for
 * the other ways a number can be older than it looks.
 */
import { BENCHMARK, NSE_SYMBOLS } from "../src/db/symbols.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";

const src = new YahooPriceSource(undefined, 20000);
const DAY = 86_400_000;

const all = [...NSE_SYMBOLS.map((s) => s.symbol), BENCHMARK.symbol];

const stale: string[] = [];
const noPrev: string[] = [];
const thin: string[] = [];
const missing: string[] = [];
let checked = 0;

console.log(`checking ${all.length} symbols for history that lags its own quote\n`);

for (const symbol of all) {
  const d = await src.fetch(symbol).catch(() => null);
  if (!d) {
    missing.push(symbol);
    continue;
  }
  checked++;

  const newest = d.bars.at(-1);
  if (!newest) {
    thin.push(symbol);
    continue;
  }

  const lag = d.quote.tradedAt - newest.date;
  if (lag > 7 * DAY) {
    stale.push(`${symbol} (bars stop ${Math.round(lag / DAY)} days before the quote)`);
  }
  if (d.quote.previousClose == null) noPrev.push(symbol);
  if (d.bars.length < 60) thin.push(`${symbol} (${d.bars.length} bars)`);
}

const report = (label: string, rows: string[]) => {
  console.log(`${label}: ${rows.length}`);
  for (const r of rows) console.log(`    ${r}`);
};

console.log(`priced: ${checked} of ${all.length}\n`);
report("history stops well before the quote", stale);
report("no previous close, so no day change", noPrev);
report("too little history to measure volatility", thin);
report("did not resolve", missing);

console.log(
  stale.length === 0 && missing.length === 0
    ? "\nno symbol is presenting an old close as yesterday"
    : "\nsymbols above will show a level without a day change, which is the honest reading",
);
