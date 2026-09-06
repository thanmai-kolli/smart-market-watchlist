import { Router } from "express";
import type {
  Intent,
  Profile,
  SearchResponse,
  WatchlistEntry,
  WatchlistResponse,
} from "../../../shared/types.ts";
import type { QuoteCache } from "../ingestion/cache.ts";
import { dayChangePct } from "../ingestion/types.ts";
import type { Store } from "../db/store.ts";

export function watchlistRoutes(store: Store, cache: QuoteCache): Router {
  const router = Router();

  /** Watchlist plus current prices, so the client never makes a second round trip. */
  async function withPrices(
    sessionId: string,
    listId?: string | null,
  ): Promise<WatchlistResponse> {
    const rows = store.getWatchlist(sessionId, listId);
    const quotes = await cache.getMany([...new Set(rows.map((r) => r.symbol))]);

    const items: WatchlistEntry[] = rows.map((row) => {
      const quote = quotes.get(row.symbol)?.quote;
      return {
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        addedAt: row.addedAt,
        lastSeenAt: row.lastSeenAt,
        price: quote?.price ?? null,
        previousClose: quote?.previousClose ?? null,
        changePct: quote ? dayChangePct(quote) : null,
        // A symbol we could not price is reported as unknown rather than
        // silently omitted; the user still sees it is on their list.
        dataState: quote?.state ?? "unknown",
        tradedAt: quote?.tradedAt ?? null,
        intent: row.intent,
        listId: row.listId,
        listName: row.listName,
      };
    });

    return {
      items,
      lists: store.getLists(sessionId),
      activeListId: listId ?? null,
    };
  }

  /** Only a list this session owns, so an id from elsewhere reads as "all lists". */
  function scopeOf(req: { sessionId: string; query: Record<string, unknown> }): string | null {
    const raw = req.query.list;
    if (typeof raw !== "string" || raw.length === 0) return null;
    return store.listBelongsTo(req.sessionId, raw) ? raw : null;
  }

  router.get("/watchlist", async (req, res) => {
    res.json(await withPrices(req.sessionId, scopeOf(req)));
  });

  router.post("/watchlist", async (req, res) => {
    const body = req.body as { symbol?: unknown; list?: unknown };
    if (typeof body?.symbol !== "string" || body.symbol.length > 24) {
      res.status(400).json({ error: "symbol required" });
      return;
    }

    const list = typeof body.list === "string" ? body.list : null;
    if (!store.addToWatchlist(req.sessionId, body.symbol, list)) {
      res.status(404).json({ error: "Unknown symbol" });
      return;
    }
    res.status(201).json(await withPrices(req.sessionId, scopeOf(req)));
  });

  router.delete("/watchlist", async (req, res) => {
    const symbol = req.query.symbol;
    if (typeof symbol !== "string") {
      res.status(400).json({ error: "symbol required" });
      return;
    }

    store.removeFromWatchlist(req.sessionId, symbol, scopeOf(req));
    res.json(await withPrices(req.sessionId, scopeOf(req)));
  });

  // ─── Lists ────────────────────────────────────────────────────────────────

  router.post("/lists", async (req, res) => {
    const name = (req.body as { name?: unknown })?.name;
    if (typeof name !== "string") {
      res.status(400).json({ error: "name required" });
      return;
    }

    const created = store.createList(req.sessionId, name);
    if (!created) {
      res.status(400).json({ error: "A list needs a name" });
      return;
    }
    res.status(201).json(await withPrices(req.sessionId, created.id));
  });

  router.patch("/lists", async (req, res) => {
    const body = req.body as { list?: unknown; name?: unknown };
    if (typeof body?.list !== "string" || typeof body.name !== "string") {
      res.status(400).json({ error: "list and name required" });
      return;
    }

    if (!store.renameList(req.sessionId, body.list, body.name)) {
      res.status(404).json({ error: "No such list" });
      return;
    }
    res.json(await withPrices(req.sessionId, body.list));
  });

  router.delete("/lists", async (req, res) => {
    const list = req.query.list;
    if (typeof list !== "string") {
      res.status(400).json({ error: "list required" });
      return;
    }

    // Refusing the last list keeps "somewhere to put a symbol" an invariant
    // rather than a case every caller has to remember to handle.
    if (!store.deleteList(req.sessionId, list)) {
      res.status(409).json({ error: "Your last list cannot be deleted" });
      return;
    }
    res.json(await withPrices(req.sessionId, null));
  });

  router.post("/intent", async (req, res) => {
    const body = req.body as { symbol?: unknown; list?: unknown; intent?: unknown };
    const allowed = new Set(["none", "buy", "hold"]);
    if (
      typeof body?.symbol !== "string" ||
      typeof body.list !== "string" ||
      typeof body.intent !== "string" ||
      !allowed.has(body.intent)
    ) {
      res.status(400).json({ error: "symbol, list and intent required" });
      return;
    }

    if (!store.listBelongsTo(req.sessionId, body.list)) {
      res.status(404).json({ error: "No such list" });
      return;
    }
    store.setIntent(req.sessionId, body.list, body.symbol, body.intent as Intent);
    res.json(await withPrices(req.sessionId, scopeOf(req)));
  });

  router.get("/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length === 0) {
      res.json({ results: [] } satisfies SearchResponse);
      return;
    }
    res.json({ results: store.searchSymbols(q.slice(0, 32)) } satisfies SearchResponse);
  });

  router.post("/ack", (req, res) => {
    const symbol = (req.body as { symbol?: unknown })?.symbol;
    if (typeof symbol !== "string" || symbol.length > 24) {
      res.status(400).json({ error: "symbol required" });
      return;
    }

    // Server clock, not the client's: a skewed or hostile client must not be
    // able to push its own baseline into the future and silence itself forever.
    store.acknowledge(req.sessionId, symbol, Date.now());
    res.json({ ok: true });
  });

  /**
   * Erase everything, now rather than in ninety days.
   *
   * Retention answers what happens when someone forgets about us; this answers
   * when they would rather not wait. The next request simply gets a new session.
   */
  router.post("/forget", (req, res) => {
    store.forget(req.sessionId);
    res.json({ ok: true });
  });

  router.get("/profile", (req, res) => {
    res.json({ name: store.displayName(req.sessionId) } satisfies Profile);
  });

  router.post("/profile", (req, res) => {
    const name = (req.body as { name?: unknown })?.name;
    if (typeof name !== "string" || name.length > 64) {
      res.status(400).json({ error: "name required" });
      return;
    }
    res.json({ name: store.setDisplayName(req.sessionId, name) } satisfies Profile);
  });

  return router;
}
