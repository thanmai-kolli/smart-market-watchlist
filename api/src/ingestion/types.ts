import type { DataState } from "../../../shared/types.ts";

/**
 * A price is never a bare number.
 *
 * It carries when the trade happened, when we fetched it, where it came from and
 * how much to trust it. Most watchlist bugs come from collapsing those into one
 * float and then forgetting which one you had.
 */
export interface Quote {
  symbol: string;
  price: number;
  /** Close of the session before this one. Null when the feed gives us too few
   *  bars to know -- better than guessing and reporting a confident 0.00%. */
  previousClose: number | null;
  /** When the last trade actually happened. */
  tradedAt: number;
  /** When we pulled it. Staleness is (now - tradedAt), never (now - fetchedAt). */
  fetchedAt: number;
  currency: string;
  exchange: string;
  state: DataState;
  source: string;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Today's regular session from the exchange feed. Being the *current* period,
   *  it handles holidays implicitly, so no hardcoded market calendar is needed. */
  session: { start: number; end: number } | null;
}

/** Change across the latest session, or null when there is no close to measure from. */
export function dayChangePct(quote: Quote): number | null {
  const base = quote.previousClose;
  if (base == null || base === 0) return null;
  return ((quote.price - base) / base) * 100;
}

/** One trading day. `adjClose` already accounts for splits, bonuses and dividends. */
export interface Bar {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Use this for anything comparing across time. Raw close lies across a split. */
  adjClose: number;
  volume: number;
}

export interface SymbolData {
  quote: Quote;
  bars: Bar[];
}

export interface PriceSource {
  readonly name: string;
  fetch(symbol: string): Promise<SymbolData>;
  fetchMany(symbols: string[]): Promise<Map<string, SymbolData>>;
}

/** A split, bonus, dividend or similar — the reason a price can drop without a loss. */
export interface CorporateAction {
  symbol: string;
  exDate: number;
  subject: string;
  kind: "split" | "bonus" | "dividend" | "rights" | "other";
}

export class PriceSourceError extends Error {
  readonly symbol: string;

  constructor(message: string, symbol: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PriceSourceError";
    this.symbol = symbol;
  }
}
