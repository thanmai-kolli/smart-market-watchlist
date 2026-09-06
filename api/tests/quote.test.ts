/**
 * The reference price a day change is measured from.
 *
 * This had a silent bug worth locking down: Yahoo's chart meta carries no
 * `previousClose` for NSE symbols, and the `chartPreviousClose` beside it is the
 * close before the *requested range*. Reading it turned every day change into a
 * six-month change, and nothing failed loudly — HDFCBANK simply reported
 * -18.02% on a day it moved +0.77%.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, priorClose } from "../src/ingestion/yahoo.ts";

const DAY = 86_400_000;
const OPEN = Date.UTC(2026, 8, 4, 3, 45); // 09:15 IST, when a daily bar is stamped

/** Daily bar timestamps in seconds, as the feed returns them. */
function stamps(count: number, endingAt = OPEN): number[] {
  return Array.from({ length: count }, (_, i) =>
    Math.floor((endingAt - (count - 1 - i) * DAY) / 1000),
  );
}

test("uses the prior session, not the start of the requested range", () => {
  // Six months of history where only the last two closes matter.
  const closes = Array.from({ length: 120 }, (_, i) => 500 + i);
  const tradedAt = OPEN + 6 * 3_600_000; // a trade during the final session

  assert.equal(priorClose(stamps(120), closes, tradedAt), 618);
  assert.notEqual(priorClose(stamps(120), closes, tradedAt), closes[0]);
});

test("reads the session before the current one while trading is live", () => {
  const tradedAt = OPEN + 2 * 3_600_000; // mid-session, final bar still forming
  assert.equal(priorClose(stamps(3), [100, 110, 121], tradedAt), 110);
});

test("reads the session before the last one after the close", () => {
  const tradedAt = OPEN + 6 * 3_600_000; // after the final bar was stamped
  assert.equal(priorClose(stamps(3), [100, 110, 121], tradedAt), 110);
});

test("falls back to the newest bar when the feed runs ahead of history", () => {
  const tradedAt = OPEN + 3 * DAY; // quote is fresh, bars have not caught up
  assert.equal(priorClose(stamps(3), [100, 110, 121], tradedAt), 121);
});

test("refuses a reference point once the bars have stopped being published", () => {
  // Some sector indices keep quoting long after their daily bars stop updating.
  // Reading the last one as "yesterday" turns a quarter of drift into a day.
  const tradedAt = OPEN + 49 * DAY;

  assert.equal(priorClose(stamps(3), [100, 110, 121], tradedAt), null);
});

test("a long weekend is still a previous session, not a stale feed", () => {
  const tradedAt = OPEN + 4 * DAY;
  assert.equal(priorClose(stamps(3), [100, 110, 121], tradedAt), 121);
});

test("skips holidays rather than treating a gap as a session", () => {
  const tradedAt = OPEN + 6 * 3_600_000;
  assert.equal(priorClose(stamps(4), [100, null, 110, 121], tradedAt), 110);
});

test("reports null rather than inventing a reference point", () => {
  const tradedAt = OPEN + 6 * 3_600_000;
  assert.equal(priorClose(stamps(1), [121], tradedAt), null);
  assert.equal(priorClose([], [], tradedAt), null);
  assert.equal(priorClose(undefined, undefined, tradedAt), null);
});

/**
 * A stock frozen at its circuit band and a stock nobody is trading look
 * identical on price alone. Telling the user the wrong one is the failure this
 * covers, so the volume test that separates them is pinned here.
 */
const SESSION = { start: OPEN, end: OPEN + 6.25 * 3_600_000 };
const MID_SESSION = OPEN + 3 * 3_600_000;
const LONG_AGO = MID_SESSION - 30 * 60_000;

test("a frozen price on the day's high with volume behind it is a lock", () => {
  const state = classify(SESSION, LONG_AGO, MID_SESSION, {
    price: 120,
    dayHigh: 120,
    dayLow: 110,
    volume: 900_000,
  });
  assert.equal(state, "halted");
});

test("the same freeze on the day's low is also a lock", () => {
  const state = classify(SESSION, LONG_AGO, MID_SESSION, {
    price: 110,
    dayHigh: 120,
    dayLow: 110,
    volume: 900_000,
  });
  assert.equal(state, "halted");
});

test("a frozen price nobody traded is stale, not halted", () => {
  const state = classify(SESSION, LONG_AGO, MID_SESSION, {
    price: 120,
    dayHigh: 120,
    dayLow: 120,
    volume: 0,
  });
  assert.equal(state, "stale");
});

test("a frozen price away from either extreme is stale", () => {
  const state = classify(SESSION, LONG_AGO, MID_SESSION, {
    price: 115,
    dayHigh: 120,
    dayLow: 110,
    volume: 900_000,
  });
  assert.equal(state, "stale");
});

test("a stock sitting at its high but still trading is live", () => {
  const state = classify(SESSION, MID_SESSION, MID_SESSION, {
    price: 120,
    dayHigh: 120,
    dayLow: 110,
    volume: 900_000,
  });
  assert.equal(state, "live");
});

test("outside the session a price at the high is closed, not halted", () => {
  const after = SESSION.end + 3_600_000;
  const state = classify(SESSION, SESSION.end, after, {
    price: 120,
    dayHigh: 120,
    dayLow: 110,
    volume: 900_000,
  });
  assert.equal(state, "closed");
});
