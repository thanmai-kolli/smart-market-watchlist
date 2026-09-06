/**
 * The scoring pipeline: a price change goes in, a decision comes out.
 *
 * Pure. Every input is passed in and every output is a value, so the whole
 * judgement of this product can be read in one file and tested with plain
 * numbers — no database, no network, no clock.
 *
 * Gates are correctness: failing one removes a symbol entirely, because showing
 * it would be wrong. Scores are judgement: a low one just ranks below the fold.
 */
import type { CardKind, DataState, Intent, Working } from "../../../shared/types.ts";
import type { Bar, CorporateAction, Quote } from "../ingestion/types.ts";
import {
  priceAsOf,
  relativeVolume,
  type SymbolStats,
  tradingDaysBetween,
} from "./stats.ts";

export interface Candidate {
  symbol: string;
  name: string;
  sector: string;
  quote: Quote;
  bars: Bar[];
  stats: SymbolStats;
  /** When this user last acknowledged this symbol. */
  anchorAt: number;
  actions?: CorporateAction[];
  /** The user's own stated position. Breaks ties only — see weight(). */
  intent?: Intent;
}

export interface MarketContext {
  /** Market return over the same window, as a fraction. */
  marketReturn: number;
  now: number;
}

export interface Scored {
  symbol: string;
  name: string;
  sector: string;
  kind: CardKind;
  headline: string;
  reasons: string[];
  returnPct: number;
  zScore: number;
  score: number;
  dataState: DataState;
  working: Working;
  /** Set when a gate removed it. Kept rather than dropped, so we can say why. */
  suppressed?: string;
}

/** Below this a move is noise; the value is measured, not assumed — see calibrate.ts. */
export function score(c: Candidate, market: MarketContext): Scored {
  const base = {
    symbol: c.symbol,
    name: c.name,
    sector: c.sector,
    dataState: c.quote.state,
  };

  // ── Gate 1: is there anything to compare against? ────────────────────────
  const priceThen = priceAsOf(c.bars, c.anchorAt);
  if (priceThen == null || priceThen <= 0) {
    return {
      ...base,
      ...empty(c.quote.price),
      suppressed: "No price history before your last visit",
    };
  }

  const priceNow = c.quote.price;
  const rawReturn = Math.log(priceNow / priceThen);

  // ── Gate 2: corporate actions ────────────────────────────────────────────
  // Bars carry adjusted closes, so a split is already neutralised in the maths.
  // The action is still detected so the card can explain the apparent drop
  // rather than leaving the user to reconcile it against another app.
  const action = actionInWindow(c.actions, c.anchorAt, market.now);

  // ── Gate 3: is the data usable? ──────────────────────────────────────────
  if (c.quote.state === "unknown") {
    return {
      ...base,
      ...empty(priceNow),
      suppressed: "No usable price for this symbol",
    };
  }

  // ── Score ────────────────────────────────────────────────────────────────
  const days = tradingDaysBetween(c.bars, c.anchorAt, market.now);
  const expectedOneSigma = c.stats.dailySigma * Math.sqrt(days);

  const marketExplains = c.stats.beta * market.marketReturn;
  const idiosyncratic = rawReturn - marketExplains;
  const z = expectedOneSigma > 0 ? idiosyncratic / expectedOneSigma : 0;

  const rvol = relativeVolume(c.quote.volume, c.stats.avgVolume);

  const working: Working = {
    priceThen,
    priceNow,
    returnPct: pct(rawReturn),
    marketReturnPct: pct(market.marketReturn),
    beta: round(c.stats.beta, 2),
    marketExplainsPct: pct(marketExplains),
    idiosyncraticPct: pct(idiosyncratic),
    dailySigmaPct: round(c.stats.dailySigma * 100, 2),
    tradingDaysElapsed: round(days, 1),
    expectedOneSigmaPct: round(expectedOneSigma * 100, 2),
    zScore: round(z, 2),
    relativeVolume: rvol == null ? null : round(rvol, 1),
  };

  const kind = classify(action, c.quote);
  const magnitude = Math.abs(z);

  return {
    ...base,
    kind,
    headline: headlineFor(kind, c, working, action),
    reasons: reasonsFor(kind, c, working, market, rvol, action),
    returnPct: working.returnPct,
    zScore: working.zScore,
    score: weight(kind, magnitude, rvol, c.stats, c.intent),
    working,
  };
}

/**
 * How far a declared position can move something up the order.
 *
 * Small enough that it can only separate near-equals: a stock you said you were
 * buying never outranks a genuinely larger move elsewhere. Direction is
 * deliberately not used — a fall matters to a holder and a rise matters to a
 * buyer, and guessing which one someone means is the assumption this product
 * exists to avoid.
 */
const INTENT_TIEBREAK = 0.05;

/**
 * Final ranking weight.
 *
 * Volume confirmation nudges rather than dominates: a big move on thin volume is
 * still worth knowing about, just less trustworthy. A fallback sigma is
 * discounted because the z-score behind it is a guess about an unfamiliar stock.
 */
function weight(
  kind: CardKind,
  magnitude: number,
  rvol: number | null,
  stats: SymbolStats,
  intent: Intent = "none",
): number {
  let s = magnitude;

  if (kind === "halt") s += 2; // a frozen price is news regardless of size
  if (kind === "corporate_action") s = Math.max(s, 1.5); // must be explained

  if (rvol != null) {
    if (rvol >= 2) s *= 1.25;
    else if (rvol < 0.5) s *= 0.8;
  }

  if (stats.sigmaSource === "fallback") s *= 0.7;
  if (intent !== "none") s += INTENT_TIEBREAK;

  return round(s, 3);
}

function classify(action: CorporateAction | null, quote: Quote): CardKind {
  if (action) return "corporate_action";
  if (quote.state === "halted") return "halt";

  const { price, fiftyTwoWeekHigh: hi, fiftyTwoWeekLow: lo } = quote;
  if ((hi != null && price >= hi) || (lo != null && price <= lo)) return "level";

  return "move";
}

function headlineFor(
  kind: CardKind,
  c: Candidate,
  w: Working,
  action: CorporateAction | null,
): string {
  const name = c.symbol.replace(".NS", "");
  const dir = w.returnPct >= 0 ? "up" : "down";
  const size = Math.abs(w.returnPct).toFixed(1);

  switch (kind) {
    case "corporate_action":
      return `${name} — ${action?.subject ?? "corporate action"} went ex-date`;
    case "halt":
      return `${name} is halted at ₹${w.priceNow.toFixed(2)}`;
    case "level":
      return `${name} ${dir} ${size}% — at a 52-week ${w.returnPct >= 0 ? "high" : "low"}`;
    default:
      return `${name} ${dir} ${size}%`;
  }
}

function reasonsFor(
  kind: CardKind,
  c: Candidate,
  w: Working,
  market: MarketContext,
  rvol: number | null,
  action: CorporateAction | null,
): string[] {
  const reasons: string[] = [];

  if (kind === "corporate_action" && action) {
    // The headline figure spans the whole anchor window, which can be positive
    // even when the ex-date itself knocked the price down, so the wording has to
    // hold either way.
    reasons.push(
      action.kind === "dividend"
        ? "Part of this move is the dividend leaving the price, not a verdict on the company."
        : "Your share count changed; your value did not.",
    );
    reasons.push("A tracker comparing raw prices would read the ex-date drop as a crash.");
    return reasons;
  }

  if (kind === "halt") {
    reasons.push("Trading is stopped — the frozen price is the news, not calm.");
  }

  // Sigma first: it is the number that turns a percentage into a judgement.
  const mag = Math.abs(w.zScore);
  if (mag >= 3) reasons.push(`${mag.toFixed(1)}σ — extreme for this stock`);
  else if (mag >= 2) reasons.push(`${mag.toFixed(1)}σ — unusual for this stock`);
  else reasons.push(`${mag.toFixed(1)}σ — within its normal range`);

  // Only claim the market explains it when it actually does.
  const explained = Math.abs(w.marketExplainsPct);
  const own = Math.abs(w.idiosyncraticPct);
  if (explained > 0.3 && explained > own * 0.6) {
    reasons.push(
      `Mostly the market — NIFTY moved ${w.marketReturnPct.toFixed(1)}%`,
    );
  } else if (Math.abs(w.marketReturnPct) < 0.5) {
    reasons.push("Market was flat — this is specific to the stock");
  } else {
    reasons.push(
      `Market explains ${w.marketExplainsPct.toFixed(1)}% of it; the rest is the stock`,
    );
  }

  if (rvol != null) {
    if (rvol >= 2) reasons.push(`Volume ${rvol.toFixed(1)}× normal — well traded`);
    else if (rvol < 0.5) reasons.push(`Volume ${rvol.toFixed(1)}× normal — thin`);
  }

  if (c.stats.sigmaSource === "fallback") {
    reasons.push("Not enough history for a reliable baseline — treat with caution");
  }

  return reasons;
}

function actionInWindow(
  actions: CorporateAction[] | undefined,
  from: number,
  to: number,
): CorporateAction | null {
  if (!actions) return null;
  // Splits and bonuses distort a raw comparison far more than dividends, so
  // prefer them when several fall inside the window.
  const inside = actions.filter((a) => a.exDate > from && a.exDate <= to);
  return (
    inside.find((a) => a.kind === "split" || a.kind === "bonus") ??
    inside[0] ??
    null
  );
}

function empty(price: number) {
  return {
    kind: "move" as CardKind,
    headline: "",
    reasons: [],
    returnPct: 0,
    zScore: 0,
    score: 0,
    working: {
      priceThen: price,
      priceNow: price,
      returnPct: 0,
      marketReturnPct: 0,
      beta: 1,
      marketExplainsPct: 0,
      idiosyncraticPct: 0,
      dailySigmaPct: 0,
      tradingDaysElapsed: 0,
      expectedOneSigmaPct: 0,
      zScore: 0,
      relativeVolume: null,
    } satisfies Working,
  };
}

const pct = (logReturn: number): number => round((Math.exp(logReturn) - 1) * 100, 2);
const round = (x: number, dp: number): number =>
  Math.round(x * 10 ** dp) / 10 ** dp;
