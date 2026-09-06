/**
 * The six market situations this product exists to get right.
 *
 * Each is a case a conventional watchlist handles badly. They are synthetic on
 * purpose: a real feed will not produce a stock split or a circuit lock on
 * demand, and these need to run in milliseconds on every change.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bar, CorporateAction, Quote } from "../src/ingestion/types.ts";
import { score, type Candidate } from "../src/scoring/pipeline.ts";
import { rank } from "../src/scoring/rank.ts";
import { computeStats } from "../src/scoring/stats.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/** Daily bars with a fixed wobble, so sigma is predictable rather than random. */
function series(
  start: number,
  days: number,
  dailyMovePct: number,
  drift = 0,
): Bar[] {
  const bars: Bar[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    // Alternating so returns have a known spread; +drift shifts the whole path.
    price *= 1 + (i % 2 === 0 ? dailyMovePct : -dailyMovePct) / 100 + drift / 100;
    bars.push({
      date: T0 + i * DAY,
      open: price,
      high: price,
      low: price,
      close: price,
      adjClose: price,
      volume: 1_000_000,
    });
  }
  return bars;
}

function quote(price: number, extra: Partial<Quote> = {}): Quote {
  return {
    symbol: "TEST.NS",
    price,
    previousClose: price,
    tradedAt: T0 + 100 * DAY,
    fetchedAt: T0 + 100 * DAY,
    currency: "INR",
    exchange: "NSE",
    state: "live",
    source: "test",
    dayHigh: null,
    dayLow: null,
    volume: 1_000_000,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    session: null,
    ...extra,
  };
}

function candidate(over: Partial<Candidate> & { bars: Bar[] }): Candidate {
  const market = series(100, 100, 0.8);
  return {
    symbol: "TEST.NS",
    name: "Test Co",
    sector: "IT",
    quote: quote(over.bars[over.bars.length - 1]!.adjClose),
    stats: computeStats(over.bars, market),
    anchorAt: T0 + 90 * DAY,
    ...over,
  };
}

const FLAT_MARKET = { marketReturn: 0, now: T0 + 100 * DAY };

// ─── Case 1 ─────────────────────────────────────────────────────────────────

test("a big move today is nothing if the week nets out flat", () => {
  const bars = series(100, 100, 1.5);
  const c = candidate({ bars, anchorAt: T0 + 94 * DAY });
  const s = score(c, FLAT_MARKET);

  assert.ok(
    Math.abs(s.zScore) < 2,
    `flat-over-the-window should not qualify, got ${s.zScore}σ`,
  );
});

// ─── Case 2 ─────────────────────────────────────────────────────────────────

test("a move well beyond the stock's own range earns a card", () => {
  const bars = series(100, 99, 0.5);
  const last = bars[bars.length - 1]!;
  bars.push({ ...last, date: last.date + DAY, adjClose: last.adjClose * 0.94 });

  const c = candidate({
    bars,
    anchorAt: T0 + 98 * DAY,
    quote: quote(bars[bars.length - 1]!.adjClose, { volume: 3_500_000 }),
  });
  const s = score(c, FLAT_MARKET);

  assert.ok(Math.abs(s.zScore) >= 2, `expected >=2 sigma, got ${s.zScore}`);
  assert.ok(
    s.reasons.some((r) => r.includes("specific to the stock")),
    "flat market means the move is the stock's own",
  );
  assert.ok(
    s.reasons.some((r) => r.includes("Volume")),
    "heavy volume should be called out as confirmation",
  );
});

// ─── Case 3 · the trap ──────────────────────────────────────────────────────

test("a bonus issue is explained, not reported as a crash", () => {
  // Adjusted closes already account for the bonus, so the series is continuous
  // even though the raw price halved. This is what stops the false alarm.
  const bars = series(100, 100, 0.7);
  const action: CorporateAction = {
    symbol: "TEST.NS",
    exDate: T0 + 95 * DAY,
    subject: "Bonus 1:1",
    kind: "bonus",
  };

  const s = score(candidate({ bars, actions: [action] }), FLAT_MARKET);

  assert.equal(s.kind, "corporate_action");
  assert.match(s.headline, /Bonus 1:1/);
  assert.ok(
    s.reasons.some((r) => r.includes("share count changed")),
    "must say the holding changed shape, not value",
  );
  assert.ok(
    Math.abs(s.returnPct) < 10,
    `adjusted series must not show a crash, got ${s.returnPct}%`,
  );
});

// ─── Case 4 ─────────────────────────────────────────────────────────────────

test("a whole sector moving together becomes one card, not five", () => {
  const scored = ["TCS", "INFY", "WIPRO", "HCLTECH", "TECHM"].map((sym) => {
    const bars = series(100, 99, 0.5);
    const last = bars[bars.length - 1]!;
    bars.push({ ...last, date: last.date + DAY, adjClose: last.adjClose * 0.965 });

    return score(
      candidate({
        bars,
        symbol: `${sym}.NS`,
        name: sym,
        sector: "IT",
        anchorAt: T0 + 98 * DAY,
        quote: quote(bars[bars.length - 1]!.adjClose),
      }),
      FLAT_MARKET,
    );
  });

  const { cards } = rank(scored, { threshold: 2, budget: 3 });
  const cluster = cards.find((c) => c.kind === "cluster");

  assert.ok(cluster, "five correlated movers should fold into one card");
  assert.equal(cluster.members?.length, 5);
  assert.match(cluster.headline, /5 IT stocks moved together/);
  assert.ok(
    cluster.reasons.some((r) => r.includes("none of them moved on their own")),
    "the point of the cluster card is that nothing moved independently",
  );
});

// ─── Case 5 ─────────────────────────────────────────────────────────────────

test("a halted stock is surfaced because the price stopped moving", () => {
  const bars = series(100, 100, 0.6);
  const s = score(
    candidate({
      bars,
      quote: quote(bars[bars.length - 1]!.adjClose, { state: "halted" }),
    }),
    FLAT_MARKET,
  );

  assert.equal(s.kind, "halt");
  assert.ok(
    s.reasons.some((r) => r.includes("frozen price is the news")),
    "a frozen price must not be read as calm",
  );

  const { cards } = rank([s], { threshold: 2, budget: 3 });
  assert.equal(cards.length, 1, "a halt qualifies regardless of move size");
});

// ─── Case 6 ─────────────────────────────────────────────────────────────────

test("the market's own move is stripped out before judging", () => {
  const bars = series(100, 99, 0.6);
  const last = bars[bars.length - 1]!;
  bars.push({ ...last, date: last.date + DAY, adjClose: last.adjClose * 0.96 });
  const c = candidate({ bars, anchorAt: T0 + 98 * DAY });

  const alone = score(c, { marketReturn: 0, now: T0 + 100 * DAY });
  // Same fall, but the whole market fell with it — the tide, not the stock.
  const withMarket = score(c, {
    marketReturn: Math.log(0.96),
    now: T0 + 100 * DAY,
  });

  assert.ok(
    Math.abs(withMarket.zScore) < Math.abs(alone.zScore),
    "a market-wide fall must score lower than a solo one",
  );
  assert.ok(
    withMarket.reasons.some((r) => r.toLowerCase().includes("market")),
    "the card should say the market explains it",
  );
});

// ─── Guards ─────────────────────────────────────────────────────────────────

test("a new listing with no history is flagged rather than trusted", () => {
  const bars = series(100, 5, 1.0);
  const s = score(candidate({ bars, anchorAt: T0 + 2 * DAY }), FLAT_MARKET);

  assert.ok(
    s.reasons.some((r) => r.includes("Not enough history")),
    "a guessed baseline must be disclosed",
  );
  assert.ok(Number.isFinite(s.zScore), "must not divide by a zero sigma");
});

test("a suspended stock with a flat series does not score infinitely", () => {
  const bars = series(100, 60, 0); // never moves
  const s = score(candidate({ bars }), FLAT_MARKET);

  assert.ok(Number.isFinite(s.zScore), `got ${s.zScore}`);
  assert.ok(Math.abs(s.zScore) < 100, "zero volatility must not blow up the score");
});

test("also-ran list is ranked and excludes what was already shown", () => {
  const scored = [3.5, 2.4, 1.4, 0.9, 0.3].map((z, i) =>
    score(
      candidate({
        bars: series(100, 99, 0.5).concat({
          date: T0 + 99 * DAY,
          open: 100, high: 100, low: 100, close: 100,
          adjClose: 100 * (1 - z * 0.012),
          volume: 1_000_000,
        }),
        symbol: `S${i}.NS`,
        name: `Stock ${i}`,
        sector: `Sector${i}`,
        anchorAt: T0 + 98 * DAY,
        quote: quote(100 * (1 - z * 0.012)),
      }),
      FLAT_MARKET,
    ),
  );

  const { cards, alsoRan } = rank(scored, { threshold: 2, budget: 3 });
  const shown = new Set(cards.map((c) => c.symbol));

  assert.ok(alsoRan.every((a) => !shown.has(a.symbol)), "no duplicates");
  for (let i = 1; i < alsoRan.length; i++) {
    assert.ok(
      Math.abs(alsoRan[i - 1]!.zScore) >= Math.abs(alsoRan[i]!.zScore),
      "also-ran must be ranked so the near miss is visible",
    );
  }
});
