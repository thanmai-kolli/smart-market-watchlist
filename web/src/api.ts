/**
 * The only file in the frontend that knows the backend exists.
 *
 * Everything else takes plain data as props, which keeps components testable and
 * means the API surface is defined in exactly one place.
 */
import type {
  Account,
  Briefing,
  IndicesResponse,
  Intent,
  Profile,
  SearchResponse,
  Showcase,
  SyncCodeResponse,
  WatchlistResponse,
} from "../../shared/types.ts";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      // Sends the session cookie cross-origin; the API allows exactly this origin.
      credentials: "include",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    // fetch rejects with "Failed to fetch" for anything from a dead server to a
    // blocked request, which tells a person nothing they can act on.
    throw new Error("Could not reach the server.");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The server returned ${res.status}.`);
  }
  return (await res.json()) as T;
}

export interface CrossCheck {
  status: "agree" | "diverged" | "unavailable";
  sources: number;
  feed?: number;
  exchange?: number;
  diffPct?: number;
  resolution?: string;
}

export interface MarketSnapshot {
  open: boolean | null;
  label: string;
  asOf: string | null;
  benchmark: {
    symbol: string;
    value: number;
    changePct: number;
    state: string;
  } | null;
  /** The exchange's own benchmark value, for cross-checking against the feed. */
  exchangeBenchmark: number | null;
  crossCheck: CrossCheck;
}

export const getHealth = () => call<{ ok: boolean; now: number }>("/api/health");

export const getMarket = () => call<MarketSnapshot>("/api/market");

export const getBriefing = (anchorAt?: number) =>
  call<Briefing>(
    `/api/briefing${anchorAt ? `?anchorAt=${anchorAt}` : ""}`,
  );

const listQuery = (list: string | null) =>
  list ? `?list=${encodeURIComponent(list)}` : "";

export const getWatchlist = (list: string | null = null) =>
  call<WatchlistResponse>(`/api/watchlist${listQuery(list)}`);

export const searchSymbols = (q: string) =>
  call<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);

export const addSymbol = (symbol: string, list: string | null = null) =>
  call<WatchlistResponse>(`/api/watchlist${listQuery(list)}`, {
    method: "POST",
    body: JSON.stringify({ symbol, list }),
  });

export const removeSymbol = (symbol: string, list: string | null = null) =>
  call<WatchlistResponse>(
    `/api/watchlist?symbol=${encodeURIComponent(symbol)}${list ? `&list=${encodeURIComponent(list)}` : ""}`,
    { method: "DELETE" },
  );

export const createList = (name: string) =>
  call<WatchlistResponse>("/api/lists", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const renameList = (list: string, name: string) =>
  call<WatchlistResponse>("/api/lists", {
    method: "PATCH",
    body: JSON.stringify({ list, name }),
  });

export const deleteList = (list: string) =>
  call<WatchlistResponse>(`/api/lists?list=${encodeURIComponent(list)}`, {
    method: "DELETE",
  });

export const setIntent = (symbol: string, list: string, intent: Intent) =>
  call<WatchlistResponse>(`/api/intent${listQuery(list)}`, {
    method: "POST",
    body: JSON.stringify({ symbol, list, intent }),
  });

export const forgetMe = () => call<{ ok: true }>("/api/forget", { method: "POST" });

export const acknowledge = (symbol: string) =>
  call<{ ok: true }>("/api/ack", {
    method: "POST",
    body: JSON.stringify({ symbol }),
  });

export const issueSyncCode = () =>
  call<SyncCodeResponse>("/api/sync/code", { method: "POST" });

export const getShowcase = () => call<Showcase>("/api/showcase");

export const getIndices = () => call<IndicesResponse>("/api/indices");

export const getAccount = () => call<Account>("/api/auth/me");

export const register = (email: string, password: string) =>
  call<Account>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logIn = (email: string, password: string) =>
  call<Account>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logOut = () => call<{ ok: true }>("/api/auth/logout", { method: "POST" });

export const getProfile = () => call<Profile>("/api/profile");

export const setProfileName = (name: string) =>
  call<Profile>("/api/profile", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const redeemSyncCode = (code: string) =>
  call<{ ok: true }>("/api/sync/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
