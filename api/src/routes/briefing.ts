import { Router } from "express";
import type { Briefing, DataState, Intent } from "../../../shared/types.ts";
import { config } from "../config.ts";
import type { Store } from "../db/store.ts";
import type { QuoteCache } from "../ingestion/cache.ts";
import { getCorporateActions } from "../ingestion/nse.ts";
import type { CorporateAction, SymbolData } from "../ingestion/types.ts";
import { score, type Candidate, type Scored } from "../scoring/pipeline.ts";
import { rank } from "../scoring/rank.ts";
import { computeStats } from "../scoring/stats.ts";
import { priceAsOf } from "../scoring/stats.ts";

/**
 * Only ask NSE about a symbol whose price moved enough that a corporate action
 * could be the explanation. Fetching actions for everything on every request
 * would make the briefing slow to rule out something that rarely applies.
 */
const ACTION_LOOKUP_THRESHOLD_PCT = 8;

export function briefingRoutes(store: Store, cache: QuoteCache): Router {
  const router = Router();

  router.get("/briefing", async (req, res) => {
    const rows = store.getWatchlist(req.sessionId);
    const lists = store.getLists(req.sessionId);
    const now = Date.now();

    if (rows.length === 0) {
      res.json(emptyBriefing(now, now, "unknown", "Nothing tracked yet"));
      return;
    }

    // The same symbol in two lists is two membership rows but one thing to
    // judge, so they collapse here. Which lists it belonged to survives, because
    // that is what lets a single global budget stay legible.
    const bySymbol = new Map<
      string,
      { row: (typeof rows)[number]; lists: Array<{ id: string; name: string }>; intent: Intent }
    >();
    for (const row of rows) {
      const found = bySymbol.get(row.symbol);
      if (found) {
        found.lists.push({ id: row.listId, name: row.listName });
        if (found.intent === "none") found.intent = row.intent;
      } else {
        bySymbol.set(row.symbol, {
          row,
          lists: [{ id: row.listId, name: row.listName }],
          intent: row.intent,
        });
      }
    }
    const unique = [...bySymbol.values()];

    // An explicit anchor overrides per-symbol history, which is what makes the
    // "since" control able to answer "what if I'd been away a month?".
    const override = Number(req.query.anchorAt);
    const explicitAnchor = Number.isFinite(override) && override > 0 ? override : null;

    const symbols = unique.map((u) => u.row.symbol);
    const [quotes, benchmark] = await Promise.all([
      cache.getMany(symbols),
      cache.get(config.benchmark),
    ]);

    const marketState: DataState = benchmark?.quote.state ?? "unknown";
    const marketLabel = describeMarket(marketState, benchmark?.quote.tradedAt);

    const build = async (anchorFor: (symbol: string, fallback: number) => number) => {
      const candidates: Candidate[] = [];

      for (const { row, intent } of unique) {
        const data = quotes.get(row.symbol);
        if (!data) continue;

        candidates.push({
          symbol: row.symbol,
          name: row.name,
          sector: row.sector,
          quote: data.quote,
          bars: data.bars,
          stats: computeStats(data.bars, benchmark?.bars ?? []),
          anchorAt: anchorFor(row.symbol, row.lastSeenAt),
          intent,
        });
      }

      await attachActions(candidates);

      const scored: Scored[] = candidates.map((c) =>
        score(c, {
          marketReturn: marketReturn(benchmark, c.anchorAt),
          now,
        }),
      );

      return rank(scored, {
        threshold: config.zThreshold,
        budget: config.cardBudget,
      });
    };

    // First pass: each symbol against when the user actually last saw it.
    let anchorUsed = explicitAnchor ?? oldest(unique.map((u) => u.row.lastSeenAt));
    let result = await build((_s, fallback) => explicitAnchor ?? fallback);
    let widenedFrom: Briefing["widenedFrom"];

    // If nothing cleared the bar, look further back rather than showing an empty
    // screen. "Nothing this week, but here is the last thing that mattered" is
    // more useful than silence, and it is what a person would actually ask next.
    // Widening only makes sense when the silence is real. With nothing priced,
    // every rung would rescore an empty universe and make the slowest possible
    // answer out of the least informative one.
    if (result.cards.length === 0 && !explicitAnchor && quotes.size > 0) {
      const original = anchorUsed;

      // A new session's anchor is backdated so the first screen is not empty, so
      // "has a marker" is not the same as "was told". The anchor only moves past
      // the moment a symbol was added when somebody actually pressed Got it.
      const acknowledged = new Set(
        unique.filter((u) => u.row.lastSeenAt > u.row.addedAt).map((u) => u.row.symbol),
      );

      for (const days of config.widenLadderDays) {
        const widened = now - days * 86_400_000;
        if (widened >= original) continue;

        // Widening looks for what someone has not seen. Reaching back past a
        // dismissal would hand them the very card they just cleared, breaking
        // the one promise this product makes about not repeating itself.
        const attempt = await build((symbol, lastSeen) =>
          acknowledged.has(symbol) ? Math.max(widened, lastSeen) : widened,
        );
        if (attempt.cards.length > 0) {
          result = attempt;
          anchorUsed = widened;
          widenedFrom = {
            days: Math.round((now - original) / 86_400_000),
            to: widened,
          };
          break;
        }
      }
    }

    // Cards carry their list membership so a single global budget of three can
    // still be audited: every list is accounted for, including the quiet ones.
    const cards = result.cards.map((card) => {
      const found = bySymbol.get(card.symbol);
      if (!found) return card;
      return {
        ...card,
        lists: found.lists.map((l) => l.name),
        ...(found.intent === "none" ? {} : { intent: found.intent }),
      };
    });

    const listTally = lists.map((l) => ({
      id: l.id,
      name: l.name,
      cards: result.cards.filter((c) =>
        bySymbol.get(c.symbol)?.lists.some((x) => x.id === l.id),
      ).length,
      checked: l.count,
    }));

    const briefing: Briefing = {
      anchorAt: anchorUsed,
      anchorLabel: describeAnchor(anchorUsed, now),
      symbolsChecked: quotes.size,
      symbolsTotal: unique.length,
      cards,
      alsoRan: result.alsoRan,
      threshold: config.zThreshold,
      marketState,
      marketLabel,
      listTally,
      generatedAt: now,
      ...(widenedFrom ? { widenedFrom } : {}),
    };

    res.json(briefing);
  });

  return router;
}

/** Fetches corporate actions only for the few symbols that might need explaining. */
async function attachActions(candidates: Candidate[]): Promise<void> {
  const suspicious = candidates.filter((c) => {
    const then = priceAsOf(c.bars, c.anchorAt);
    if (then == null || then <= 0) return false;
    return Math.abs((c.quote.price / then - 1) * 100) >= ACTION_LOOKUP_THRESHOLD_PCT;
  });

  const results = await Promise.all(
    suspicious.map(async (c) => [c, await getCorporateActions(c.symbol)] as const),
  );
  for (const [candidate, actions] of results) {
    candidate.actions = actions;
  }
}

/** Market move over the same window, so like is compared with like. */
function marketReturn(benchmark: SymbolData | null, anchorAt: number): number {
  if (!benchmark) return 0;
  const then = priceAsOf(benchmark.bars, anchorAt);
  if (then == null || then <= 0) return 0;
  return Math.log(benchmark.quote.price / then);
}

function describeMarket(state: DataState, tradedAt?: number): string {
  switch (state) {
    case "live":
      return "Market open";
    case "closed":
      return tradedAt
        ? `Market closed · last traded ${new Date(tradedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
        : "Market closed";
    case "stale":
      return "Market open · benchmark not updating";
    default:
      return "Market status unavailable";
  }
}

function describeAnchor(anchorAt: number, now: number): string {
  const days = Math.round((now - anchorAt) / 86_400_000);
  const when = new Date(anchorAt).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  if (days <= 0) return `earlier today · ${when}`;
  if (days === 1) return `yesterday · ${when}`;
  return `${days} days ago · ${when}`;
}

const oldest = (times: number[]): number => Math.min(...times);

function emptyBriefing(
  anchorAt: number,
  now: number,
  marketState: DataState,
  marketLabel: string,
): Briefing {
  return {
    anchorAt,
    anchorLabel: describeAnchor(anchorAt, now),
    symbolsChecked: 0,
    symbolsTotal: 0,
    cards: [],
    alsoRan: [],
    threshold: config.zThreshold,
    marketState,
    marketLabel,
    generatedAt: now,
  };
}
