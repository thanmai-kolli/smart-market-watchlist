import { YahooPriceSource } from "../src/ingestion/yahoo.ts";

const src = new YahooPriceSource(undefined, 20000);

const INDICES = [
  "^NSEI",
  "^NSEBANK",
  "^CNXIT",
  "^CNXAUTO",
  "^CNXPHARMA",
  "^CNXFMCG",
  "^CNXMETAL",
  "^CNXENERGY",
];

const day = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

console.log("symbol        price      prevClose   derived%   lastBars (newest last)");

for (const symbol of INDICES) {
  const d = await src.fetch(symbol);
  if (!d) {
    console.log(`${symbol.padEnd(13)} no data`);
    continue;
  }

  const prev = d.quote.previousClose;
  const pct = prev ? ((d.quote.price / prev - 1) * 100).toFixed(2) : "—";
  const tail = d.bars
    .slice(-4)
    .map((b) => `${day(b.date)}=${b.close.toFixed(0)}`)
    .join(" ");

  console.log(
    `${symbol.padEnd(13)} ${d.quote.price.toFixed(2).padStart(9)} ${String(prev?.toFixed(2) ?? "—").padStart(11)} ${pct.padStart(9)}   ${tail}  (${d.bars.length} bars, traded ${day(d.quote.tradedAt)})`,
  );
}
