/**
 * Is the unofficial feed actually accurate?
 *
 * "Unofficial" describes provenance, not correctness, and the two are worth
 * separating before either is claimed on the site. NSE blocks programmatic
 * access to single-stock quotes but publishes its whole index list, so every
 * index we can name in both places becomes a measurement.
 */
const H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

/** NSE requires a session cookie from the homepage before its API answers. */
const warm = await fetch("https://www.nseindia.com/", { headers: H });
const cookie = warm.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");

const res = await fetch("https://www.nseindia.com/api/allIndices", {
  headers: { ...H, cookie, Referer: "https://www.nseindia.com/" },
});
const nse = (await res.json()) as { data: Array<{ index: string; last: number }> };
const byName = new Map(nse.data.map((d) => [d.index.toUpperCase(), d.last]));

/** Same index, named by each source. */
const PAIRS: Array<[string, string]> = [
  ["^NSEI", "NIFTY 50"],
  ["^NSEBANK", "NIFTY BANK"],
  ["^CNXIT", "NIFTY IT"],
  ["^CNXAUTO", "NIFTY AUTO"],
  ["^CNXPHARMA", "NIFTY PHARMA"],
  ["^CNXFMCG", "NIFTY FMCG"],
  ["^CNXMETAL", "NIFTY METAL"],
  ["^CNXENERGY", "NIFTY ENERGY"],
];

console.log(`\nNSE publishes ${nse.data.length} indices. Comparing the ones Yahoo also names.\n`);
console.log("  index               yahoo          NSE       difference");
console.log("  " + "─".repeat(58));

const diffs: number[] = [];
for (const [ySymbol, nseName] of PAIRS) {
  const official = byName.get(nseName);
  if (official == null) {
    console.log(`  ${nseName.padEnd(16)} not published by NSE right now`);
    continue;
  }

  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?range=5d&interval=1d`,
    { headers: { accept: "application/json" } },
  );
  if (!r.ok) {
    console.log(`  ${nseName.padEnd(16)} yahoo HTTP ${r.status}`);
    continue;
  }

  const feed = (await r.json()) as { chart: { result?: Array<{ meta: { regularMarketPrice?: number } }> } };
  const value = feed.chart.result?.[0]?.meta.regularMarketPrice;
  if (value == null) {
    console.log(`  ${nseName.padEnd(16)} yahoo had no price`);
    continue;
  }

  const diffPct = Math.abs((value - official) / official) * 100;
  diffs.push(diffPct);
  const verdict = diffPct < 0.1 ? "agree" : diffPct < 1 ? "close" : "DIVERGED";
  console.log(
    `  ${nseName.padEnd(16)} ${value.toFixed(2).padStart(10)} ${official.toFixed(2).padStart(12)}   ${diffPct.toFixed(4)}%  ${verdict}`,
  );
}

if (diffs.length > 0) {
  const worst = Math.max(...diffs);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  console.log(`\n  compared        ${diffs.length} indices`);
  console.log(`  mean difference ${mean.toFixed(4)}%`);
  console.log(`  worst           ${worst.toFixed(4)}%`);
  console.log(
    `  verdict         ${worst < 0.1 ? "the feed matches the exchange to within a rounding error" : "a real gap exists — see above"}`,
  );
}
console.log();
