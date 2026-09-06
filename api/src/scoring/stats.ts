/**
 * The statistics behind "meaningful".
 *
 * Pure functions: numbers in, numbers out. No database, no network, no clock.
 * That is what makes the judgement in this module testable with plain arrays and
 * readable without any other file open.
 */
import type { Bar } from "../ingestion/types.ts";

/** Log returns, because they add across periods and behave symmetrically. */
export function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev == null || curr == null || prev <= 0 || curr <= 0) continue;
    out.push(Math.log(curr / prev));
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation — n−1, since these are a sample of possible days. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;

  const mx = mean(xs.slice(-n));
  const my = mean(ys.slice(-n));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (xs[xs.length - n + i]! - mx) * (ys[ys.length - n + i]! - my);
  }
  return sum / (n - 1);
}

/**
 * How hard this stock gets dragged when the market moves.
 *
 * Falls back to 1.0 rather than 0 when the market barely moved: assuming a stock
 * is completely independent of the market is a stronger claim than assuming it
 * moves with it, and the wrong one to make by accident.
 */
export function beta(stockReturns: number[], marketReturns: number[]): number {
  const marketVariance = stdev(marketReturns) ** 2;
  if (marketVariance < 1e-12) return 1;

  const b = covariance(stockReturns, marketReturns) / marketVariance;
  // Estimates from short windows can be wild; clamp to a defensible range.
  return Math.max(-1, Math.min(3, b));
}

export interface SymbolStats {
  /** Daily volatility as a fraction, e.g. 0.014 for 1.4%. */
  dailySigma: number;
  beta: number;
  avgVolume: number;
  barCount: number;
  /** Where sigma came from, so the UI can be honest when it is a fallback. */
  sigmaSource: "own" | "fallback";
}

/** Used when a listing is too new to have its own history. */
const FALLBACK_SIGMA = 0.02;

const MIN_BARS_FOR_SIGMA = 20;

export function computeStats(
  bars: Bar[],
  marketBars: Bar[],
  volumeWindow = 20,
): SymbolStats {
  const closes = bars.map((b) => b.adjClose);
  const returns = logReturns(closes);

  const enough = returns.length >= MIN_BARS_FOR_SIGMA;
  const own = stdev(returns);

  // A sigma of zero means a suspended or untraded symbol. Dividing by it would
  // make every move look infinitely significant, so treat it as unusable.
  const usable = enough && own > 1e-6;

  const recentVolumes = bars.slice(-volumeWindow).map((b) => b.volume);

  return {
    dailySigma: usable ? own : FALLBACK_SIGMA,
    beta: alignedBeta(bars, marketBars),
    avgVolume: mean(recentVolumes.filter((v) => v > 0)),
    barCount: bars.length,
    sigmaSource: usable ? "own" : "fallback",
  };
}

/**
 * Beta needs the two series lined up by date. Holidays and halts mean a stock
 * can be missing days the index has, and comparing unaligned arrays silently
 * measures the wrong thing.
 */
function alignedBeta(bars: Bar[], marketBars: Bar[]): number {
  if (marketBars.length < MIN_BARS_FOR_SIGMA) return 1;

  const marketByDay = new Map<number, number>();
  for (const b of marketBars) marketByDay.set(dayKey(b.date), b.adjClose);

  const stockCloses: number[] = [];
  const marketCloses: number[] = [];
  for (const b of bars) {
    const m = marketByDay.get(dayKey(b.date));
    if (m == null) continue;
    stockCloses.push(b.adjClose);
    marketCloses.push(m);
  }

  if (stockCloses.length < MIN_BARS_FOR_SIGMA) return 1;
  return beta(logReturns(stockCloses), logReturns(marketCloses));
}

function dayKey(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/**
 * Trading days between two moments, counted from actual bars rather than the
 * calendar — a weekend is not two days of market risk.
 */
export function tradingDaysBetween(bars: Bar[], from: number, to: number): number {
  const count = bars.filter((b) => b.date > from && b.date <= to).length;
  // Sub-session gaps still carry some risk; floor at a fraction of a day so
  // "checked ten minutes ago" does not divide by zero.
  return Math.max(count, 0.25);
}

/**
 * The adjusted price as of a past moment.
 *
 * Adjusted, always: a raw close from before a split compared against one after it
 * reports a catastrophic fall that never happened.
 */
export function priceAsOf(bars: Bar[], at: number): number | null {
  let found: number | null = null;
  for (const b of bars) {
    if (b.date <= at) found = b.adjClose;
    else break;
  }
  return found;
}

/** Today's volume against its recent norm. Confirms whether anyone was trading. */
export function relativeVolume(
  todayVolume: number | null,
  avgVolume: number,
): number | null {
  if (todayVolume == null || avgVolume <= 0) return null;
  return todayVolume / avgVolume;
}
