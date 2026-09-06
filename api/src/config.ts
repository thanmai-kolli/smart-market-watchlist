/** Central config. Every value has a working default so nothing needs a .env file. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Anchored to the repository rather than the working directory.
 *
 * The dev runner starts the API with its cwd inside api/, while scripts are run
 * from the root, so a relative default quietly produced two different databases
 * depending on how you launched. The file a user sees must not depend on that.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const config = {
  port: num(process.env.PORT, 3001),

  /** Where the frontend runs, for CORS. */
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",

  dbPath: process.env.DATABASE_PATH ?? resolve(REPO_ROOT, ".data/watchlist.db"),

  /**
   * How long a fetched quote stays usable.
   *
   * Short while trading so prices feel live; long once the market shuts, because
   * the price is frozen anyway and re-fetching it only burns rate limit.
   */
  cacheTtlOpenMs: num(process.env.CACHE_TTL_OPEN_MS, 30_000),
  cacheTtlClosedMs: num(process.env.CACHE_TTL_CLOSED_MS, 15 * 60_000),

  /** A symbol that hasn't traded in this long is stale, even with the market open. */
  staleAfterMs: num(process.env.STALE_AFTER_MS, 15 * 60_000),

  /** Benchmark that beta is measured against. Not watchable. */
  benchmark: process.env.BENCHMARK ?? "^NSEI",

  /** How long to wait on the price feed. Configurable so an outage can be
   *  reproduced on demand rather than only observed in production. */
  priceTimeoutMs: num(process.env.PRICE_TIMEOUT_MS, 8_000),

  /**
   * How many cards the briefing may show.
   *
   * A fixed budget forces ranking instead of thresholding, and makes
   * "nothing qualified" a legitimate outcome rather than a bug.
   */
  cardBudget: num(process.env.CARD_BUDGET, 3),

  /**
   * How unusual a move must be to earn a card, in standard deviations.
   *
   * Not a convention pulled from the air — see scripts/calibrate.ts, which sweeps
   * this against real history and reports the resulting cards-per-day.
   */
  zThreshold: num(process.env.Z_THRESHOLD, 2.0),

  /** A new session's anchor starts here so the first screen is never empty. */
  newSessionAnchorDays: num(process.env.NEW_SESSION_ANCHOR_DAYS, 3),

  /** How long an untouched session is kept. Most visitors arrive once and never
   *  return, and storing their demo watchlist forever is a slow leak. */
  sessionRetentionDays: num(process.env.SESSION_RETENTION_DAYS, 90),

  /** If nothing qualifies, widen the window through these before giving up. */
  widenLadderDays: [7, 14, 30, 90],
} as const;
