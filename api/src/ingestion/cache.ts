import { config } from "../config.ts";
import type { PriceSource, SymbolData } from "./types.ts";

interface Entry {
  data: SymbolData;
  expiresAt: number;
}

/**
 * Shared quote cache, keyed by symbol.
 *
 * This is the whole scalability story. Ten thousand users watching fifty symbols
 * each is five hundred thousand subscriptions, but NSE only has ~2,000 symbols —
 * so we fetch the *union* of what anyone watches, once, and every user reads from
 * the same entries. Polling per user would multiply the work by the user count
 * for no benefit.
 *
 * It also decouples serving from fetching: a request served from cache never
 * waits on the network, so the app stays responsive when the upstream is slow.
 */
export class QuoteCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<SymbolData | null>>();
  private readonly source: PriceSource;

  hits = 0;
  misses = 0;

  constructor(source: PriceSource) {
    this.source = source;
  }

  async get(symbol: string): Promise<SymbolData | null> {
    const cached = this.entries.get(symbol);
    if (cached && cached.expiresAt > Date.now()) {
      this.hits++;
      return cached.data;
    }

    // Ten users opening the app at once must not become ten identical fetches.
    const pending = this.inFlight.get(symbol);
    if (pending) return pending;

    this.misses++;
    const request = this.load(symbol, cached);
    this.inFlight.set(symbol, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(symbol);
    }
  }

  async getMany(symbols: string[]): Promise<Map<string, SymbolData>> {
    const results = await Promise.all(
      symbols.map(async (s) => [s, await this.get(s)] as const),
    );

    const out = new Map<string, SymbolData>();
    for (const [symbol, data] of results) {
      if (data) out.set(symbol, data);
    }
    return out;
  }

  private async load(
    symbol: string,
    stale: Entry | undefined,
  ): Promise<SymbolData | null> {
    try {
      const data = await this.source.fetch(symbol);
      this.entries.set(symbol, { data, expiresAt: Date.now() + ttlFor(data) });
      return data;
    } catch {
      // Upstream failed. Serving the last known price, clearly labelled, beats
      // showing an error screen — the user still learns what they came for.
      return stale?.data ?? null;
    }
  }

  stats() {
    return {
      symbols: this.entries.size,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/**
 * Once the market shuts the price is frozen, so re-fetching only burns rate limit
 * against an answer that cannot change.
 */
function ttlFor(data: SymbolData): number {
  return data.quote.state === "closed"
    ? config.cacheTtlClosedMs
    : config.cacheTtlOpenMs;
}
