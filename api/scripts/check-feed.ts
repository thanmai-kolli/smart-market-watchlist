/**
 * Proves the live data path works, end to end, against the real market.
 *   npm run check-feed -w api
 *
 * Hits the network on purpose — this is not a unit test. The point is to confirm
 * the upstream still behaves before anything is built on top of it.
 */
import { QuoteCache } from "../src/ingestion/cache.ts";
import { fetchCorporateActions, fetchMarketStatus } from "../src/ingestion/nse.ts";
import { dayChangePct } from "../src/ingestion/types.ts";
import { YahooPriceSource } from "../src/ingestion/yahoo.ts";

const SYMBOLS = ["RELIANCE.NS", "TITAN.NS", "INFY.NS", "^NSEI"];

const cache = new QuoteCache(new YahooPriceSource());

console.log("=== Yahoo: quotes + history ===\n");

for (const symbol of SYMBOLS) {
  const data = await cache.get(symbol);
  if (!data) {
    console.log(`${symbol.padEnd(13)} FAILED\n`);
    continue;
  }

  const { quote: q, bars } = data;
  const changePct = dayChangePct(q) ?? 0;
  const first = bars[0];
  const last = bars[bars.length - 1];

  console.log(`${symbol}`);
  console.log(`  price       ${q.price.toFixed(2)} ${q.currency}  (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`);
  console.log(`  state       ${q.state}`);
  console.log(`  traded      ${new Date(q.tradedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  if (q.session) {
    console.log(`  session     ${new Date(q.session.start).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} - ${new Date(q.session.end).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  }
  console.log(`  52w range   ${q.fiftyTwoWeekLow ?? "?"} - ${q.fiftyTwoWeekHigh ?? "?"}`);
  console.log(`  bars        ${bars.length}  (${first ? new Date(first.date).toISOString().slice(0, 10) : "?"} -> ${last ? new Date(last.date).toISOString().slice(0, 10) : "?"})`);
  if (first) {
    const diverged = Math.abs(first.close - first.adjClose) > 0.01;
    console.log(`  adjusted    close=${first.close.toFixed(2)} adjClose=${first.adjClose.toFixed(2)}  ${diverged ? "<- diverged: a corporate action sits in this window" : "(no action in window)"}`);
  }
  console.log();
}

console.log("=== Cache ===");
console.log(`  ${JSON.stringify(cache.stats())}`);
const before = cache.stats().misses;
await cache.get("RELIANCE.NS");
console.log(`  second fetch of RELIANCE.NS -> ${cache.stats().misses === before ? "served from cache" : "MISSED (unexpected)"}\n`);

console.log("=== NSE: market status ===");
const status = await fetchMarketStatus();
console.log(status ? `  ${status.label}  NIFTY ${status.benchmarkValue}  as of ${status.asOf}` : "  unavailable (degrading gracefully)");

console.log("\n=== NSE: corporate actions for RELIANCE ===");
const actions = await fetchCorporateActions("RELIANCE");
if (!actions) {
  console.log("  unavailable (degrading gracefully)");
} else {
  for (const a of actions.slice(0, 5)) {
    console.log(`  ${new Date(a.exDate).toISOString().slice(0, 10)}  ${a.kind.padEnd(9)} ${a.subject}`);
  }
  const trap = actions.find((a) => a.kind === "bonus" || a.kind === "split");
  if (trap) {
    console.log(`\n  ^ ${new Date(trap.exDate).toISOString().slice(0, 10)} "${trap.subject}" is a real instance of the trap:`);
    console.log(`    a naive price comparison across that date reports a false crash.`);
  }
}
