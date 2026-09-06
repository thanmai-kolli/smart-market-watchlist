/**
 * Where the numbers on screen actually come from, measured rather than described.
 *
 * Prints the upstream round trip, the cached round trip, and the full schema, so
 * the claim "the database stores no prices" can be checked rather than believed.
 */
import Database from "better-sqlite3";
import { QuoteCache } from "../src/ingestion/cache.ts";
import { fetchMarketStatus, getCorporateActions } from "../src/ingestion/nse.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";
import { config } from "../src/config.ts";

const cache = new QuoteCache(new YahooPriceSource());
const SYMBOL = "WIPRO.NS";

console.log("── 1. price feed ───────────────────────────────────────────");
const t0 = performance.now();
const cold = await cache.get(SYMBOL);
const coldMs = performance.now() - t0;

const t1 = performance.now();
await cache.get(SYMBOL);
const warmMs = performance.now() - t1;

if (!cold) {
  console.log("  upstream unreachable");
} else {
  const q = cold.quote;
  console.log(`  GET query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?range=6mo`);
  console.log(`  price        ₹${q.price}  (${q.state})`);
  console.log(`  prev close   ₹${q.previousClose}   <- from the bars, not meta`);
  console.log(`  traded at    ${new Date(q.tradedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  console.log(`  history      ${cold.bars.length} daily bars in the SAME response`);
  console.log(`  session      ${q.session ? new Date(q.session.start).toISOString() + " → " + new Date(q.session.end).toISOString() : "unknown"}`);
  console.log(`  cold fetch   ${coldMs.toFixed(0)} ms   (network)`);
  console.log(`  cached       ${warmMs.toFixed(2)} ms   (memory)`);
  console.log(`  ttl          ${q.state === "closed" ? config.cacheTtlClosedMs / 1000 + "s (market shut)" : config.cacheTtlOpenMs / 1000 + "s (market open)"}`);
}

console.log("\n── 2. exchange, for what prices cannot say ─────────────────");
const status = await fetchMarketStatus();
console.log(`  market status  ${status ? status.label : "unavailable (degrades to the feed's own session window)"}`);
const actions = await getCorporateActions(SYMBOL);
console.log(`  actions        ${actions?.length ?? 0} on record for ${SYMBOL}`);
if (actions?.[0]) {
  console.log(`                 latest: ${actions[0].kind} — ${actions[0].subject.slice(0, 40)}`);
}

console.log("\n── 3. what is actually stored ──────────────────────────────");
// Not readonly: a read-only connection cannot attach the WAL index, so it would
// report a stale snapshot and miss everything the running server has written.
const db = new Database(config.dbPath);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as Array<{ name: string }>;

let priceColumns = 0;
for (const t of tables) {
  const cols = db
    .prepare(`SELECT name, type FROM pragma_table_info('${t.name}')`)
    .all() as Array<{ name: string; type: string }>;
  const rows = (db.prepare(`SELECT COUNT(*) n FROM ${t.name}`).get() as { n: number }).n;
  priceColumns += cols.filter((c) => /price|close|value|amount/i.test(c.name)).length;
  console.log(`  ${t.name.padEnd(16)} ${String(rows).padStart(4)} rows   ${cols.map((c) => c.name).join(", ")}`);
}
console.log(`\n  columns holding a price anywhere in the database: ${priceColumns}`);
db.close();
