import type { CorporateAction } from "./types.ts";

/**
 * NSE's own endpoints, for the two things only the exchange knows.
 *
 * Their live quote API is hard-blocked (403 even with a full browser-like cookie
 * warm-up), so prices come from elsewhere. But corporate actions and market
 * status are open, and both are worth having from the source: an ex-date is what
 * separates "your stock crashed 50%" from "your share count doubled".
 *
 * Everything here degrades to null rather than throwing. NSE could tighten access
 * at any time and the briefing must still work without it.
 */

const NSE = "https://www.nseindia.com";

const BROWSERISH = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

/** NSE hands out session cookies on the homepage and rejects API calls without them. */
let cookieJar = "";
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 10 * 60_000;

async function ensureCookies(): Promise<boolean> {
  if (cookieJar && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) return true;

  try {
    const res = await fetch(NSE, {
      headers: { ...BROWSERISH, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(8000),
    });
    const pairs = (res.headers.getSetCookie?.() ?? []).map(
      (c) => c.split(";")[0] ?? "",
    );
    if (pairs.length === 0) return false;

    cookieJar = pairs.filter(Boolean).join("; ");
    cookieFetchedAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  if (!(await ensureCookies())) return null;

  try {
    const res = await fetch(`${NSE}${path}`, {
      headers: {
        ...BROWSERISH,
        accept: "*/*",
        referer: `${NSE}/`,
        "x-requested-with": "XMLHttpRequest",
        cookie: cookieJar,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Market status ──────────────────────────────────────────────────────────

interface MarketStatusResponse {
  marketState?: Array<{
    market?: string;
    marketStatus?: string;
    tradeDate?: string;
    index?: string;
    last?: number;
  }>;
}

export interface MarketStatus {
  open: boolean;
  label: string;
  /** NIFTY 50 as the exchange reports it — a second opinion on the index value. */
  benchmarkValue: number | null;
  asOf: string | null;
}

export async function fetchMarketStatus(): Promise<MarketStatus | null> {
  const body = await getJson<MarketStatusResponse>("/api/marketStatus");
  const equities = body?.marketState?.find((m) => m.market === "Capital Market");
  if (!equities) return null;

  const open = equities.marketStatus?.toLowerCase() === "open";
  return {
    open,
    label: open ? "Market open" : "Market closed",
    benchmarkValue: typeof equities.last === "number" ? equities.last : null,
    asOf: equities.tradeDate ?? null,
  };
}

// ─── Index levels ───────────────────────────────────────────────────────────

interface AllIndicesResponse {
  data?: Array<{
    index?: string;
    last?: number;
    previousClose?: number;
    percentChange?: number;
  }>;
}

export interface IndexLevel {
  last: number;
  previousClose: number | null;
  changePct: number | null;
}

/**
 * The exchange's own index levels, keyed by the name it publishes.
 *
 * The price feed quotes every index but has stopped publishing daily bars for
 * several of them, which leaves a level with no previous close to measure from.
 * NSE publishes both, so this fills the gap from the authority rather than
 * leaving the number blank or guessing at it.
 */
export async function fetchIndexLevels(): Promise<Map<string, IndexLevel> | null> {
  const body = await getJson<AllIndicesResponse>("/api/allIndices");
  if (!body?.data) return null;

  const levels = new Map<string, IndexLevel>();
  for (const row of body.data) {
    if (!row.index || typeof row.last !== "number") continue;
    levels.set(row.index.toUpperCase(), {
      last: row.last,
      previousClose: typeof row.previousClose === "number" ? row.previousClose : null,
      changePct: typeof row.percentChange === "number" ? row.percentChange : null,
    });
  }
  return levels;
}

// ─── Corporate actions ──────────────────────────────────────────────────────

interface ActionRow {
  symbol?: string;
  exDate?: string;
  subject?: string;
}

/** "28-Oct-2024" — NSE's format, not one Date can parse directly. */
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseExDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split("-");
  if (parts.length !== 3) return null;

  const day = Number(parts[0]);
  const month = MONTHS[(parts[1] ?? "").toLowerCase().slice(0, 3)];
  const year = Number(parts[2]);
  if (!Number.isFinite(day) || month === undefined || !Number.isFinite(year)) {
    return null;
  }
  return Date.UTC(year, month, day);
}

function classifyAction(subject: string): CorporateAction["kind"] {
  const s = subject.toLowerCase();
  if (s.includes("split")) return "split";
  if (s.includes("bonus")) return "bonus";
  if (s.includes("dividend")) return "dividend";
  if (s.includes("rights")) return "rights";
  return "other";
}

/** `symbol` is the bare NSE ticker — RELIANCE, not RELIANCE.NS. */
export async function fetchCorporateActions(
  symbol: string,
): Promise<CorporateAction[] | null> {
  const rows = await getJson<ActionRow[]>(
    `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`,
  );
  if (!Array.isArray(rows)) return null;

  const actions: CorporateAction[] = [];
  for (const row of rows) {
    const exDate = parseExDate(row.exDate);
    const subject = row.subject?.trim();
    if (exDate === null || !subject) continue;

    actions.push({
      symbol,
      exDate,
      subject,
      kind: classifyAction(subject),
    });
  }
  return actions;
}

const actionCache = new Map<string, { actions: CorporateAction[]; at: number }>();
const ACTION_TTL_MS = 6 * 60 * 60_000;

/**
 * Cached lookup keyed by the Yahoo-style symbol.
 *
 * Corporate actions change a few times a year, so a long TTL is generous. The
 * cache matters mostly because callers ask per symbol and NSE is slow.
 */
export async function getCorporateActions(
  yahooSymbol: string,
): Promise<CorporateAction[]> {
  const cached = actionCache.get(yahooSymbol);
  if (cached && Date.now() - cached.at < ACTION_TTL_MS) return cached.actions;

  const bare = yahooSymbol.replace(/\.(NS|BO)$/i, "");
  const fetched = await fetchCorporateActions(bare);

  // Cache the empty result too: if NSE is blocking us, retrying on every
  // request would make each briefing slower without ever succeeding.
  const actions = fetched ?? [];
  actionCache.set(yahooSymbol, { actions, at: Date.now() });
  return actions;
}
