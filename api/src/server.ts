import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { DataState, IndicesResponse, MarketIndex } from "../../shared/types.ts";
import { config } from "./config.ts";
import { Store } from "./db/store.ts";
import { QuoteCache } from "./ingestion/cache.ts";
import { fetchIndexLevels, fetchMarketStatus } from "./ingestion/nse.ts";
import { dayChangePct } from "./ingestion/types.ts";
import { YahooPriceSource } from "./ingestion/yahoo.ts";
import { authRoutes } from "./routes/auth.ts";
import { briefingRoutes } from "./routes/briefing.ts";
import { sessionMiddleware } from "./routes/session.ts";
import { showcaseRoutes } from "./routes/showcase.ts";
import { syncRoutes } from "./routes/sync.ts";
import { watchlistRoutes } from "./routes/watchlist.ts";

const store = new Store();
const cache = new QuoteCache(new YahooPriceSource(undefined, config.priceTimeoutMs));

// Retention runs in-process because it is one DELETE against a local file; a
// scheduler would be more machinery than the job it runs. unref() keeps it from
// holding the process open.
const RETENTION_MS = config.sessionRetentionDays * 86_400_000;
const sweep = () => {
  const removed = store.sweepStaleSessions(RETENTION_MS);
  if (removed > 0) console.log(`swept ${removed} session(s) untouched for ${config.sessionRetentionDays} days`);
};
sweep();
setInterval(sweep, 6 * 3_600_000).unref();

const app = express();

// The browser is a different origin (5173 vs 3001), and it must send the session
// cookie, so credentials have to be allowed explicitly for that one origin.
app.use(
  cors({
    origin: config.webOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "api", cache: cache.stats(), now: Date.now() });
});

/** Market status from the exchange itself, with the benchmark as a second opinion. */
app.get("/api/market", async (_req, res) => {  const [status, benchmark] = await Promise.all([
    fetchMarketStatus(),
    cache.get(config.benchmark),
  ]);

  const quote = benchmark?.quote;
  const feedValue = quote?.price ?? null;
  const exchangeValue = status?.benchmarkValue ?? null;

  res.json({
    open: status?.open ?? null,
    label: status?.label ?? labelFromFeed(quote?.state),
    asOf: status?.asOf ?? null,
    benchmark: quote
      ? {
          symbol: config.benchmark,
          value: quote.price,
          changePct: dayChangePct(quote),
          state: quote.state,
        }
      : null,
    exchangeBenchmark: exchangeValue,
    // Two independent sources for the same number. Divergence is reported rather
    // than hidden, because conflicting data is a real condition, not an error --
    // and a watchlist that silently picks one is lying by omission.
    crossCheck: crossCheck(feedValue, exchangeValue),
  });
});

/**
 * The sector indices, which are the ordinary market picture.
 *
 * Every one of these is checked against NSE's own published figure by
 * check-accuracy, so they are the part of this app with a measured error bar
 * rather than an assumed one.
 */
const INDICES: Array<[symbol: string, name: string]> = [
  ["^NSEI", "NIFTY 50"],
  ["^NSEBANK", "NIFTY BANK"],
  ["^CNXIT", "NIFTY IT"],
  ["^CNXAUTO", "NIFTY AUTO"],
  ["^CNXPHARMA", "NIFTY PHARMA"],
  ["^CNXFMCG", "NIFTY FMCG"],
  ["^CNXMETAL", "NIFTY METAL"],
  ["^CNXENERGY", "NIFTY ENERGY"],
];

app.get("/api/indices", async (_req, res) => {
  // The exchange is asked in parallel because the feed quotes every index but
  // has stopped publishing daily bars for several, leaving a level with no
  // previous close. NSE publishes both, so the gap is filled from the authority
  // rather than left blank or guessed at.
  const [data, levels] = await Promise.all([
    cache.getMany(INDICES.map(([symbol]) => symbol)),
    fetchIndexLevels(),
  ]);

  const indices: MarketIndex[] = [];
  for (const [symbol, name] of INDICES) {
    const found = data.get(symbol);
    if (!found) continue;

    const fromFeed = dayChangePct(found.quote);
    const fromExchange = levels?.get(name)?.changePct ?? null;
    const changePct = fromFeed ?? fromExchange;

    indices.push({
      symbol,
      name,
      value: found.quote.price,
      changePct,
      changeFrom: changePct == null ? null : fromFeed != null ? "feed" : "exchange",
      state: found.quote.state,
      tradedAt: found.quote.tradedAt,
    });
  }

  // A row carrying one timestamp is only as current as its least current
  // member, so this is the oldest rather than the newest. Taking the newest
  // would let one lagging index hide behind seven fresh ones, and the state
  // follows the same rule instead of trusting whichever symbol came first.
  const oldest =
    indices.length > 0
      ? indices.reduce((a, b) => (a.tradedAt <= b.tradedAt ? a : b))
      : null;

  res.json({
    indices,
    asOf: oldest?.tradedAt ?? null,
    state: indices.every((i) => i.state === "live") ? "live" : (oldest?.state ?? "unknown"),
  } satisfies IndicesResponse);
});

/**
 * What to say about the market when the exchange itself is unreachable.
 *
 * The price feed carries the session window with every quote, so we usually
 * still know the answer. Printing "unavailable" next to a live index value
 * would be the bigger lie, so that phrase is kept for when we truly have
 * nothing -- and the wording never claims the exchange as its source.
 */
function labelFromFeed(state: DataState | undefined): string {
  switch (state) {
    case "live":
      return "Market open";
    case "stale":
      return "Market open · feed lagging";
    case "closed":
      return "Market closed";
    case "halted":
      return "Trading halted";
    default:
      return "Market status unavailable";
  }
}

/**
 * Compares the price feed's benchmark against the exchange's own figure.
 *
 * They usually agree. When they do not it is almost always a timing difference
 * rather than a fault, so the resolution policy is stated plainly: the exchange
 * is authoritative, and the size of the gap is shown rather than smoothed away.
 */
function crossCheck(feed: number | null, exchange: number | null) {
  if (feed == null || exchange == null) {
    return { status: "unavailable" as const, sources: 1 };
  }

  const diffPct = Math.abs((feed - exchange) / exchange) * 100;
  // A tenth of a percent on an index is a sampling gap, not a disagreement.
  const agree = diffPct < 0.1;

  return {
    status: agree ? ("agree" as const) : ("diverged" as const),
    sources: 2,
    feed,
    exchange,
    diffPct: Math.round(diffPct * 1000) / 1000,
    resolution: agree
      ? "Both sources match."
      : "Sources differ; the exchange figure is treated as authoritative.",
  };
}

// Ahead of the session middleware on purpose: reading the pitch should not be
// enough to make somebody a user with stored state.
app.use("/api", showcaseRoutes(cache));

app.use(
  "/api",
  sessionMiddleware(store),
  watchlistRoutes(store, cache),
  briefingRoutes(store, cache),
  syncRoutes(store),
  authRoutes(store),
);

app.listen(config.port, () => {
  console.log(`api listening on http://localhost:${config.port}`);
});
