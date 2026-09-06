import type { DataState } from "../../../shared/types.ts";
import { config } from "../config.ts";
import {
  type Bar,
  type PriceSource,
  PriceSourceError,
  type Quote,
  type SymbolData,
} from "./types.ts";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Symbols reach this from user input and go into a URL path, so allow only
 * ticker characters. Leading caret is how indices are addressed (^NSEI).
 */
const SYMBOL_PATTERN = /^\^?[A-Z0-9]{1,12}([.\-&][A-Z0-9]{1,6})*$/i;

interface YahooChart {
  chart: {
    error: { code: string; description: string } | null;
    result?: Array<{
      meta: {
        symbol: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
        currency?: string;
        fullExchangeName?: string;
        exchangeName?: string;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
        currentTradingPeriod?: { regular?: { start?: number; end?: number } };
      };
      timestamp?: number[];
      indicators: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
    }>;
  };
}

/**
 * Live quotes and daily history from Yahoo's public chart endpoint.
 *
 * A single request returns the current price AND the daily history including
 * adjusted closes, which means corporate-action correctness comes for free
 * rather than needing a separate actions feed just to avoid false crash alerts.
 *
 * Unofficial, delayed and rate-limited — which is exactly why it sits behind
 * the PriceSource interface rather than being called directly.
 */
export class YahooPriceSource implements PriceSource {
  readonly name = "yahoo";
  private readonly range: string;
  private readonly timeoutMs: number;

  constructor(range = "6mo", timeoutMs = 8000) {
    this.range = range;
    this.timeoutMs = timeoutMs;
  }

  async fetch(symbol: string): Promise<SymbolData> {
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new PriceSourceError("Malformed symbol", symbol);
    }

    const url = `${BASE}/${encodeURIComponent(symbol)}?range=${this.range}&interval=1d`;
    const body = await this.getJson(url, symbol);

    if (body.chart.error) {
      throw new PriceSourceError(body.chart.error.description, symbol);
    }
    const result = body.chart.result?.[0];
    if (!result) throw new PriceSourceError("No data returned", symbol);

    return { quote: toQuote(symbol, result, this.name), bars: toBars(result) };
  }

  /**
   * Failures are per-symbol, not fatal: one dead ticker must not blank the whole
   * briefing. Callers see which symbols are missing and degrade around them.
   */
  async fetchMany(symbols: string[]): Promise<Map<string, SymbolData>> {
    const settled = await Promise.allSettled(
      symbols.map(async (s) => [s, await this.fetch(s)] as const),
    );

    const out = new Map<string, SymbolData>();
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        out.set(outcome.value[0], outcome.value[1]);
      }
    }
    return out;
  }

  private async getJson(url: string, symbol: string): Promise<YahooChart> {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch (cause) {
      throw new PriceSourceError("Network request failed", symbol, { cause });
    }

    if (!res.ok) throw new PriceSourceError(`HTTP ${res.status}`, symbol);

    try {
      return (await res.json()) as YahooChart;
    } catch (cause) {
      throw new PriceSourceError("Response was not valid JSON", symbol, { cause });
    }
  }
}

type ChartResult = NonNullable<YahooChart["chart"]["result"]>[number];

function toQuote(symbol: string, r: ChartResult, source: string): Quote {
  const m = r.meta;
  const price = m.regularMarketPrice;
  if (typeof price !== "number") {
    throw new PriceSourceError("Response had no price", symbol);
  }

  const tradedAt = (m.regularMarketTime ?? Date.now() / 1000) * 1000;
  const fetchedAt = Date.now();
  const reg = m.currentTradingPeriod?.regular;
  const session =
    reg?.start != null && reg.end != null
      ? { start: reg.start * 1000, end: reg.end * 1000 }
      : null;

  const dayHigh = m.regularMarketDayHigh ?? null;
  const dayLow = m.regularMarketDayLow ?? null;
  const volume = m.regularMarketVolume ?? null;

  return {
    symbol,
    price,
    previousClose: priorClose(r.timestamp, r.indicators.quote?.[0]?.close, tradedAt),
    tradedAt,
    fetchedAt,
    currency: m.currency ?? "INR",
    exchange: m.fullExchangeName ?? m.exchangeName ?? "unknown",
    state: classify(session, tradedAt, fetchedAt, { price, dayHigh, dayLow, volume }),
    source,
    dayHigh,
    dayLow,
    volume,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    session,
  };
}

/**
 * The close of the session before the one the current price belongs to.
 *
 * Yahoo's chart meta has no `previousClose` for NSE symbols, and
 * `chartPreviousClose` is the close *before the requested range* — six months
 * back — so reading it turns every day change into a six-month change. The
 * daily bars in the same response carry the real answer.
 */
export function priorClose(
  stamps: number[] | undefined,
  closes: (number | null)[] | undefined,
  tradedAt: number,
): number | null {
  const bars: Array<{ at: number; close: number }> = [];
  for (let i = 0; i < (stamps?.length ?? 0); i++) {
    const at = stamps?.[i];
    const close = closes?.[i];
    if (at != null && close != null) bars.push({ at: at * 1000, close });
  }

  const last = bars.at(-1);
  if (!last) return null;

  // Once a session has printed a bar, that bar is where the current price lives,
  // so the reference point is the one before it. Comparing against the session
  // window rather than a calendar date keeps this free of timezone assumptions.
  const currentSession = tradedAt >= last.at && tradedAt < last.at + 86_400_000;
  if (currentSession) return bars.at(-2)?.close ?? null;

  // Otherwise the newest bar is supposed to be the previous session. Some feeds
  // keep quoting an index long after they stop publishing its daily bars, and
  // treating a bar from seven weeks ago as yesterday reports a quarter of drift
  // as a single day's move. A week is past any weekend or holiday run.
  if (tradedAt - last.at > 7 * 86_400_000) return null;
  return last.close;
}

function toBars(r: ChartResult): Bar[] {
  const stamps = r.timestamp ?? [];
  const q = r.indicators.quote?.[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  if (!q) return [];

  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = q.close?.[i];
    const stamp = stamps[i];
    // Holidays and halts arrive as nulls. Skip rather than interpolate — an
    // invented bar would quietly corrupt the volatility estimate.
    if (stamp == null || close == null) continue;

    bars.push({
      date: stamp * 1000,
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      adjClose: adj?.[i] ?? close,
      volume: q.volume?.[i] ?? 0,
    });
  }
  return bars;
}

/**
 * Market state derived from the session window rather than a status string.
 *
 * `closed` means the market is shut and the price is correctly frozen.
 * `stale` means the market is OPEN but this symbol has not traded recently —
 * an illiquid stock whose displayed price is genuinely old. Reporting one as
 * the other misleads the user in opposite directions.
 */
export function classify(
  session: { start: number; end: number } | null,
  tradedAt: number,
  now: number,
  band?: Band,
): DataState {
  if (!session) return "unknown";
  if (now < session.start || now > session.end) return "closed";
  if (now - tradedAt <= config.staleAfterMs) return "live";
  return lockedAtBand(band) ? "halted" : "stale";
}

interface Band {
  price: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
}

/**
 * Tells a circuit lock apart from mere illiquidity.
 *
 * The public feed carries no halt flag, so this infers one: a price that has
 * stopped updating while sitting exactly on the day's extreme is a stock that
 * ran into its band, and the volume behind it is what separates that from a
 * stock nobody traded. Both look identical on price alone, which is why the
 * volume test is not optional.
 */
function lockedAtBand(band?: Band): boolean {
  if (!band) return false;
  const { price, dayHigh, dayLow, volume } = band;
  if (dayHigh == null || dayLow == null) return false;
  if (volume == null || volume <= 0) return false;
  return price === dayHigh || price === dayLow;
}
