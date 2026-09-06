/**
 * Checks every seeded symbol still resolves upstream.
 *   npm run check-symbols -w api
 *
 * Tickers die: companies demerge, rename or delist. A seed list that quietly
 * contains a dead symbol means anyone cloning this sees a broken row on first run.
 */
import { NSE_SYMBOLS, BENCHMARK } from "../src/db/symbols.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";

const source = new YahooPriceSource("1mo");
const all = [...NSE_SYMBOLS, BENCHMARK];

const dead: string[] = [];
const thin: string[] = [];

console.log(`Checking ${all.length} symbols…\n`);

for (const s of all) {
  try {
    const { quote, bars } = await source.fetch(s.symbol);
    if (bars.length < 15) {
      thin.push(`${s.symbol} (${bars.length} bars)`);
      console.log(`  THIN  ${s.symbol.padEnd(16)} ${bars.length} bars`);
    } else {
      console.log(
        `  ok    ${s.symbol.padEnd(16)} ${quote.price.toFixed(2).padStart(10)}  ${bars.length} bars`,
      );
    }
  } catch (err) {
    dead.push(s.symbol);
    console.log(
      `  DEAD  ${s.symbol.padEnd(16)} ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

console.log(`\n${all.length - dead.length - thin.length} ok · ${thin.length} thin · ${dead.length} dead`);

if (dead.length > 0) {
  console.log(`\nRemove or replace in src/db/symbols.ts:\n  ${dead.join("\n  ")}`);
  process.exitCode = 1;
}
