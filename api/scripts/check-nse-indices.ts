import { fetchIndexLevels } from "../src/ingestion/nse.ts";

const levels = await fetchIndexLevels();
if (!levels) {
  console.log("NSE unreachable");
} else {
  console.log(`NSE published ${levels.size} indices\n`);
  for (const name of [
    "NIFTY 50",
    "NIFTY BANK",
    "NIFTY IT",
    "NIFTY AUTO",
    "NIFTY PHARMA",
    "NIFTY FMCG",
    "NIFTY METAL",
    "NIFTY ENERGY",
  ]) {
    const row = levels.get(name);
    console.log(
      row
        ? `  ${name.padEnd(14)} last=${String(row.last).padStart(10)}  prevClose=${String(row.previousClose ?? "—").padStart(10)}  change=${row.changePct == null ? "—" : row.changePct.toFixed(2) + "%"}`
        : `  ${name.padEnd(14)} not published`,
    );
  }
}
