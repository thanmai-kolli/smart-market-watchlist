/**
 * The contract between the two services.
 *
 * Types only, so both sides use `import type` and the whole file disappears at
 * compile time. No bundler config, no shared runtime package — but changing a
 * response shape still breaks the build on both sides.
 */

// ─── Market data ────────────────────────────────────────────────────────────

/**
 * Why a price might not be what it appears.
 *
 * `closed` and `stale` are deliberately separate: closed means the market is shut
 * and the price is correctly frozen, stale means the market is OPEN but this
 * symbol has not traded recently. Collapsing them misleads in opposite directions.
 */
export type DataState =
  | "live"
  | "delayed"
  | "stale"
  | "closed"
  | "halted"
  | "unknown";

export interface SymbolInfo {
  symbol: string;
  name: string;
  sector: string;
}

// ─── The briefing ───────────────────────────────────────────────────────────

/** Why a card was surfaced. Drives the wording and the sort. */
export type CardKind =
  | "move" // unusual price move
  | "cluster" // several correlated symbols moved together
  | "corporate_action" // split/bonus/dividend — explained, not alarmed
  | "halt" // circuit locked; the freeze IS the news
  | "level"; // 52-week high/low broken

/** The arithmetic behind a card, shown when the user taps "Why?". */
export interface Working {
  priceThen: number;
  priceNow: number;
  returnPct: number;
  marketReturnPct: number;
  beta: number;
  marketExplainsPct: number;
  idiosyncraticPct: number;
  dailySigmaPct: number;
  tradingDaysElapsed: number;
  expectedOneSigmaPct: number;
  zScore: number;
  relativeVolume: number | null;
}

export interface BriefingCard {
  kind: CardKind;
  symbol: string;
  name: string;
  sector: string;
  headline: string;
  /** One short clause per reason. Each maps to a stage of the scoring pipeline. */
  reasons: string[];
  returnPct: number;
  zScore: number;
  score: number;
  dataState: DataState;
  /** Present for cluster cards: the other symbols folded into this one. */
  members?: string[];
  /** Which of the user's lists this came from, so a global budget stays legible. */
  lists?: string[];
  intent?: Intent;
  working?: Working;
}

/** A symbol that was scored but did not clear the bar. Proves everything was looked at. */
export interface AlsoRan {
  symbol: string;
  name: string;
  returnPct: number;
  zScore: number;
}

export interface Briefing {
  /** The moment everything is measured from — the user's clock, not the market's. */
  anchorAt: number;
  anchorLabel: string;
  symbolsChecked: number;
  /** What was asked for. Below symbolsChecked means the feed could not answer for
   *  some of it — the difference is what separates "nothing happened" from
   *  "I could not look", and the two must never render the same. */
  symbolsTotal: number;
  cards: BriefingCard[];
  /** Ranked, so "nothing qualified" reads as a near miss rather than an empty void. */
  alsoRan: AlsoRan[];
  /** Set when the window was widened because nothing qualified in the original one. */
  widenedFrom?: { days: number; to: number };
  threshold: number;
  marketState: DataState;
  marketLabel: string;
  /** One entry per list, so lists with nothing to say are still accounted for. */
  listTally?: Array<{ id: string; name: string; cards: number; checked: number }>;
  generatedAt: number;
}

// ─── Watchlist ──────────────────────────────────────────────────────────────

/**
 * What the user says they are doing with a stock.
 *
 * Describes their position, never an action to take: a fall is welcome news
 * when you are waiting to buy and unwelcome when you are holding, so the same
 * z-score deserves different wording. It shifts ranking between equals and
 * nothing else.
 */
export type Intent = "none" | "buy" | "hold";

export interface WatchlistSummary {
  id: string;
  name: string;
  createdAt: number;
  count: number;
}

export interface WatchlistEntry extends SymbolInfo {
  addedAt: number;
  lastSeenAt: number;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  dataState: DataState;
  tradedAt: number | null;
  intent: Intent;
  listId: string;
  listName: string;
}

export interface WatchlistResponse {
  items: WatchlistEntry[];
  lists: WatchlistSummary[];
  activeListId: string | null;
}

export interface SearchResponse {
  results: SymbolInfo[];
}

export interface AckRequest {
  symbol: string;
}

export interface SyncCodeResponse {
  code: string;
}

/**
 * A name, and nothing else.
 *
 * There is no password because there is nothing to protect that the session
 * cookie does not already hold. Naming yourself is for recognising which list
 * you are looking at, not for proving who you are.
 */
export interface Profile {
  name: string | null;
}

/** Null until somebody chooses to have one. The product never requires it. */
export interface Account {
  account: { id: string; email: string } | null;
}

/** One index, as any market page shows it. */
export interface MarketIndex {
  symbol: string;
  name: string;
  value: number;
  changePct: number | null;
  /** Which source the change came from, since the feed cannot always supply it. */
  changeFrom: "feed" | "exchange" | null;
  state: DataState;
  tradedAt: number;
}

export interface IndicesResponse {
  indices: MarketIndex[];
  /** The session these figures come from, so a stale one cannot pass as today. */
  asOf: number | null;
  state: DataState;
}

/** One symbol as an ordinary watchlist would show it: price, and today's change. */
export interface ShowcaseQuote {
  symbol: string;
  price: number;
  changePct: number | null;
}

/** The same symbol judged the way this product judges it. */
export interface ShowcaseStandout {
  symbol: string;
  returnPct: number;
  zScore: number;
  reasons: string[];
  /** How far back the window reached to find it. */
  days: number;
  todayPct: number | null;
}

/**
 * The landing page comparison, computed rather than written down.
 *
 * Read-only and sessionless: it illustrates the product with the same scoring
 * the product uses, so the numbers on the landing page cannot drift away from
 * the numbers in the app below it.
 */
export interface Showcase {
  asOf: number;
  marketState: DataState;
  quotes: ShowcaseQuote[];
  standout: ShowcaseStandout | null;
}

export interface ApiError {
  error: string;
}
