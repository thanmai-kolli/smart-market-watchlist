import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "../config.ts";
import { BENCHMARK, DEMO_WATCHLIST, NSE_SYMBOLS, type SeedSymbol } from "./symbols.ts";

const USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
`;

const SCHEMA = `
${USERS_TABLE}

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  sync_code     TEXT UNIQUE,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL DEFAULT 0,
  display_name  TEXT,
  user_id       TEXT
);

CREATE TABLE IF NOT EXISTS symbols (
  symbol  TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  sector  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlists (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- session_id is denormalised so "everything this person tracks, across every
-- list" stays a single indexed read. That query runs on every briefing.
CREATE TABLE IF NOT EXISTS watchlist_items (
  list_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  intent      TEXT NOT NULL DEFAULT 'none',
  PRIMARY KEY (list_id, symbol),
  FOREIGN KEY (list_id)    REFERENCES watchlists(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id)   ON DELETE CASCADE
);

-- Stores WHEN the user last looked, never AT WHAT PRICE.
-- A corporate action between visits would silently corrupt a stored price;
-- a stored timestamp cannot go wrong, and the price is derived from the
-- adjusted series at read time.
--
-- Deliberately keyed by symbol and NOT by list: the news is about the company,
-- so being made to dismiss the same dividend once per list would be the exact
-- cry-wolf failure the product exists to avoid.
CREATE TABLE IF NOT EXISTS seen_state (
  session_id    TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, symbol),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`;

/** Applied only once the table shape is current, since one index needs list_id. */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_watchlist_session  ON watchlist_items(session_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_list     ON watchlist_items(list_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_session ON watchlists(session_id);
`;

/** Where a session's symbols go before it has named a list of its own. */
const DEFAULT_LIST_NAME = "My watchlist";

/** What the user says they are doing with a stock. Never a recommendation. */
export type Intent = "none" | "buy" | "hold";

export interface WatchlistSummary {
  id: string;
  name: string;
  createdAt: number;
  count: number;
}

export interface WatchlistRow {
  symbol: string;
  name: string;
  sector: string;
  addedAt: number;
  lastSeenAt: number;
  intent: Intent;
  listId: string;
  listName: string;
}

/**
 * All SQL lives here.
 *
 * SQLite because the workload is tens of megabytes, read-heavy, and a single
 * instance — the same reasoning that leads teams to embedded analytics engines
 * rather than a cluster. It also means the app runs from a clean clone with no
 * database server, no Docker and no connection string.
 *
 * Swapping to Postgres means reimplementing this one class.
 */
export class Store {
  private readonly db: Database.Database;

  constructor(path = config.dbPath) {
    const full = resolve(process.cwd(), path);
    mkdirSync(dirname(full), { recursive: true });

    this.db = new Database(full);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // Without this a write that meets a concurrent one fails instantly rather
    // than waiting its turn -- the difference between a pause and a lost list.
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.migrateToLists();
    this.migrateSessionActivity();
    this.migrateProfile();
    this.migrateAccounts();
    this.db.exec(INDEXES);
    this.seedSymbols();
  }

  /**
   * Repairs a database that still carries the abandoned sign-in.
   *
   * An earlier version of this app had Google accounts, and its users table
   * survives in any database created back then. CREATE TABLE IF NOT EXISTS sees
   * a users table and does nothing, so a fresh clone worked and every older
   * database answered every registration with a constraint error. Those rows
   * cannot be carried across either: they were identified by Google and have no
   * password to migrate, and nothing left in the codebase can authenticate one.
   */
  private migrateAccounts(): void {
    // The column comes first: repairing the table below has to clear it, and on
    // a database old enough to need that repair it does not exist yet.
    const sessionColumns = this.db
      .prepare("SELECT name FROM pragma_table_info('sessions')")
      .all() as Array<{ name: string }>;
    if (!sessionColumns.some((c) => c.name === "user_id")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT");
    }

    const userColumns = this.db
      .prepare("SELECT name FROM pragma_table_info('users')")
      .all() as Array<{ name: string }>;
    if (userColumns.length === 0 || userColumns.some((c) => c.name === "password_hash")) {
      return;
    }

    this.db.transaction(() => {
      this.db.exec("UPDATE sessions SET user_id = NULL");
      this.db.exec("DROP TABLE users");
      this.db.exec(USERS_TABLE);
    })();
  }

  /** Nullable on purpose: nobody is made to name themselves to use this. */
  private migrateProfile(): void {
    const columns = this.db
      .prepare("SELECT name FROM pragma_table_info('sessions')")
      .all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === "display_name")) return;

    this.db.exec("ALTER TABLE sessions ADD COLUMN display_name TEXT");
  }

  /**
   * Adds the activity column to a database written before sessions were swept.
   *
   * Existing rows are dated from their creation rather than zero, so nobody's
   * watchlist becomes instantly eligible for deletion by upgrading.
   */
  private migrateSessionActivity(): void {
    const columns = this.db
      .prepare("SELECT name FROM pragma_table_info('sessions')")
      .all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === "last_seen_at")) return;

    this.db.transaction(() => {
      this.db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0");
      this.db.exec("UPDATE sessions SET last_seen_at = created_at");
    })();
  }

  /**
   * Moves a pre-lists database onto the current shape.
   *
   * The check is the absence of the column rather than a version counter, so it
   * describes the condition it actually repairs and stays correct even if a
   * database is restored from an older backup. Fresh databases get the current
   * shape from SCHEMA and fall straight through.
   */
  private migrateToLists(): void {
    const columns = this.db
      .prepare("SELECT name FROM pragma_table_info('watchlist_items')")
      .all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === "list_id")) return;

    const now = Date.now();
    this.db.transaction(() => {
      const sessions = this.db
        .prepare("SELECT DISTINCT session_id AS id FROM watchlist_items")
        .all() as Array<{ id: string }>;

      const makeList = this.db.prepare(
        "INSERT INTO watchlists (id, session_id, name, created_at) VALUES (?, ?, ?, ?)",
      );
      const listFor = new Map<string, string>();
      for (const s of sessions) {
        const listId = randomUUID();
        makeList.run(listId, s.id, DEFAULT_LIST_NAME, now);
        listFor.set(s.id, listId);
      }

      const old = this.db
        .prepare("SELECT session_id AS sessionId, symbol, added_at AS addedAt FROM watchlist_items")
        .all() as Array<{ sessionId: string; symbol: string; addedAt: number }>;

      this.db.exec("DROP TABLE watchlist_items");
      this.db.exec(SCHEMA);

      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO watchlist_items (list_id, session_id, symbol, added_at, intent)
         VALUES (?, ?, ?, ?, 'none')`,
      );
      for (const row of old) {
        const listId = listFor.get(row.sessionId);
        if (listId) insert.run(listId, row.sessionId, row.symbol, row.addedAt);
      }
    })();
  }

  /**
   * Reconciles the symbol table with the universe on every start.
   *
   * There is deliberately no "already seeded" shortcut. With one, adding a
   * symbol would reach a fresh clone and never reach a database that already
   * existed, so the people running it longest would silently have the smallest
   * universe. Upserting also lets a rename land: Zomato became Eternal, and the
   * name people still search by follows the ticker across.
   */
  private seedSymbols(): void {
    const insert = this.db.prepare(
      `INSERT INTO symbols (symbol, name, sector) VALUES (?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE
         SET name = excluded.name, sector = excluded.sector`,
    );
    const all: SeedSymbol[] = [...NSE_SYMBOLS, BENCHMARK];
    this.db.transaction(() => {
      for (const s of all) insert.run(s.symbol, s.name, s.sector);
    })();
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  /**
   * A new session arrives pre-populated, with its anchor already in the past.
   *
   * Without that, a first visit has last_seen_at = now, so nothing has changed
   * and the briefing is empty — meaning a first-time visitor never sees the one
   * thing that makes this product different. Most visitors only ever visit once.
   */
  createSession(): string {
    const id = randomUUID();
    const listId = randomUUID();
    const now = Date.now();
    const anchor = now - config.newSessionAnchorDays * 86_400_000;

    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO sessions (id, created_at, last_seen_at) VALUES (?, ?, ?)")
        .run(id, now, now);      this.db
        .prepare(
          "INSERT INTO watchlists (id, session_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(listId, id, DEFAULT_LIST_NAME, now);

      const addItem = this.db.prepare(
        `INSERT OR IGNORE INTO watchlist_items (list_id, session_id, symbol, added_at, intent)
         VALUES (?, ?, ?, ?, 'none')`,
      );
      const addSeen = this.db.prepare(
        "INSERT OR IGNORE INTO seen_state (session_id, symbol, last_seen_at) VALUES (?, ?, ?)",
      );
      for (const symbol of DEMO_WATCHLIST) {
        addItem.run(listId, id, symbol, now);
        addSeen.run(id, symbol, anchor);
      }
    })();

    return id;
  }

  sessionExists(id: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id) !== undefined
    );
  }

  /** Marks a session as still in use, so the sweep can tell abandoned from quiet. */
  touchSession(id: string, at = Date.now()): void {
    this.db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?")
      .run(at, id, at);
  }

  /**
   * Deletes sessions nobody has come back to.
   *
   * Everything else cascades from the session row, so this one statement is the
   * whole retention policy. It is driven by last activity rather than creation
   * date, because a two-year-old watchlist someone opens weekly is not stale --
   * and getting that backwards would delete exactly the people who care most.
   */
  sweepStaleSessions(olderThanMs: number, now = Date.now()): number {
    const cutoff = now - olderThanMs;
    return this.db
      .prepare(
        // A signed-in list is kept on purpose. Retention is for the people who
        // never came back, not for the ones who asked us to hold onto it.
        "DELETE FROM sessions WHERE user_id IS NULL AND last_seen_at > 0 AND last_seen_at < ?",
      )
      .run(cutoff).changes;
  }

  /**
   * Erases everything a person has stored, immediately.
   *
   * Lists, memberships and the record of what they had already been told all
   * cascade from this row, so forgetting is one statement too. Retention covers
   * the person who never comes back; this covers the one who would rather not
   * wait ninety days.
   */
  forget(sessionId: string): void {
    // Erase everything means the account too, or "delete my data" would quietly
    // leave the row that identifies the person behind.
    this.db.transaction(() => {
      const owner = this.userIdFor(sessionId);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      if (owner) this.db.prepare("DELETE FROM users WHERE id = ?").run(owner);
    })();
  }

  // ─── Accounts ─────────────────────────────────────────────────────────────

  userIdFor(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT user_id FROM sessions WHERE id = ?")
      .get(sessionId) as { user_id: string | null } | undefined;
    return row?.user_id ?? null;
  }

  accountFor(sessionId: string): { id: string; email: string } | null {
    const row = this.db
      .prepare(
        `SELECT u.id AS id, u.email AS email
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`,
      )
      .get(sessionId) as { id: string; email: string } | undefined;
    return row ?? null;
  }

  findUser(email: string): { id: string; passwordHash: string } | null {
    const row = this.db
      .prepare("SELECT id, password_hash AS passwordHash FROM users WHERE email = ?")
      .get(email) as { id: string; passwordHash: string } | undefined;
    return row ?? null;
  }

  /** Null when the email is taken. Anything else is a real fault and propagates. */
  createUser(email: string, passwordHash: string): string | null {
    const id = randomUUID();
    try {
      this.db
        .prepare(
          "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, email, passwordHash, Date.now());
      return id;
    } catch (e) {
      // Catching everything here once reported a missing table as a taken
      // address, which is a confident lie about somebody else's account.
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
      throw e;
    }
  }

  claimSession(sessionId: string, userId: string): void {
    this.db.prepare("UPDATE sessions SET user_id = ? WHERE id = ?").run(userId, sessionId);
  }

  /** The session this account already had, if any — signing in returns to it. */
  sessionForUser(userId: string, notThisOne: string): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM sessions
          WHERE user_id = ? AND id != ?
       ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .get(userId, notThisOne) as { id: string } | undefined;
    return row?.id ?? null;
  }

  signOut(sessionId: string): void {
    this.db.prepare("UPDATE sessions SET user_id = NULL WHERE id = ?").run(sessionId);
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  displayName(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT display_name FROM sessions WHERE id = ?")
      .get(sessionId) as { display_name: string | null } | undefined;
    return row?.display_name ?? null;
  }

  /** Clearing the name is a real choice, so an empty string stores NULL. */
  setDisplayName(sessionId: string, name: string): string | null {
    const clean = name.trim().slice(0, 32) || null;
    this.db
      .prepare("UPDATE sessions SET display_name = ? WHERE id = ?")
      .run(clean, sessionId);
    return clean;
  }

  // ─── Lists ────────────────────────────────────────────────────────────────

  getLists(sessionId: string): WatchlistSummary[] {
    return this.db
      .prepare(
        `SELECT l.id                AS id,
                l.name              AS name,
                l.created_at        AS createdAt,
                COUNT(w.symbol)     AS count
           FROM watchlists l
      LEFT JOIN watchlist_items w ON w.list_id = l.id
          WHERE l.session_id = ?
       GROUP BY l.id
       ORDER BY l.created_at ASC`,
      )
      .all(sessionId) as WatchlistSummary[];
  }

  /** Guarantees a session always has somewhere to put a symbol. */
  defaultListId(sessionId: string): string {
    const row = this.db
      .prepare(
        "SELECT id FROM watchlists WHERE session_id = ? ORDER BY created_at ASC LIMIT 1",
      )
      .get(sessionId) as { id: string } | undefined;
    if (row) return row.id;

    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO watchlists (id, session_id, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, sessionId, DEFAULT_LIST_NAME, Date.now());
    return id;
  }

  createList(sessionId: string, name: string): WatchlistSummary | null {
    const clean = name.trim().slice(0, 40);
    if (clean.length === 0) return null;

    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO watchlists (id, session_id, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, sessionId, clean, now);
    return { id, name: clean, createdAt: now, count: 0 };
  }

  renameList(sessionId: string, listId: string, name: string): boolean {
    const clean = name.trim().slice(0, 40);
    if (clean.length === 0) return false;
    const res = this.db
      .prepare("UPDATE watchlists SET name = ? WHERE id = ? AND session_id = ?")
      .run(clean, listId, sessionId);
    return res.changes > 0;
  }

  /**
   * Deleting a list drops its items but never the seen-state.
   *
   * If the same symbol lives in another list, forgetting that it was already
   * acknowledged would resurface old news as if it were new.
   */
  deleteList(sessionId: string, listId: string): boolean {
    const remaining = this.db
      .prepare("SELECT COUNT(*) AS n FROM watchlists WHERE session_id = ?")
      .get(sessionId) as { n: number };
    if (remaining.n <= 1) return false;

    const res = this.db
      .prepare("DELETE FROM watchlists WHERE id = ? AND session_id = ?")
      .run(listId, sessionId);
    return res.changes > 0;
  }

  listBelongsTo(sessionId: string, listId: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM watchlists WHERE id = ? AND session_id = ?")
        .get(listId, sessionId) !== undefined
    );
  }

  // ─── Watchlist ────────────────────────────────────────────────────────────

  /**
   * Everything a session tracks. Passing a list narrows it to that one.
   *
   * A symbol in two lists comes back twice, once per list, because the row
   * describes membership. Callers that care about the symbol rather than the
   * membership collapse it themselves.
   */
  getWatchlist(sessionId: string, listId?: string | null): WatchlistRow[] {
    const scoped = listId != null;
    return this.db
      .prepare(
        `SELECT w.symbol                              AS symbol,
                s.name                                AS name,
                s.sector                              AS sector,
                w.added_at                            AS addedAt,
                w.intent                              AS intent,
                l.id                                  AS listId,
                l.name                                AS listName,
                COALESCE(v.last_seen_at, w.added_at)  AS lastSeenAt
           FROM watchlist_items w
           JOIN symbols s     ON s.symbol = w.symbol
           JOIN watchlists l  ON l.id = w.list_id
      LEFT JOIN seen_state v  ON v.session_id = w.session_id AND v.symbol = w.symbol
          WHERE w.session_id = ?${scoped ? " AND w.list_id = ?" : ""}
       ORDER BY l.created_at ASC, w.added_at ASC`,
      )
      .all(...(scoped ? [sessionId, listId] : [sessionId])) as WatchlistRow[];
  }

  /** Returns false for anything not in the known universe, so an arbitrary
   *  string can never reach storage or the upstream price source. */
  addToWatchlist(sessionId: string, symbol: string, listId?: string | null): boolean {
    const known = this.db
      .prepare("SELECT 1 FROM symbols WHERE symbol = ? AND sector != 'Index'")
      .get(symbol);
    if (!known) return false;

    const target =
      listId != null && this.listBelongsTo(sessionId, listId)
        ? listId
        : this.defaultListId(sessionId);

    const now = Date.now();
    const anchor = now - config.newSessionAnchorDays * 86_400_000;
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO watchlist_items (list_id, session_id, symbol, added_at, intent)
           VALUES (?, ?, ?, ?, 'none')`,
        )
        .run(target, sessionId, symbol, now);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO seen_state (session_id, symbol, last_seen_at) VALUES (?, ?, ?)",
        )
        .run(sessionId, symbol, anchor);
    })();
    return true;
  }

  /**
   * Drops a symbol from one list, or from every list when none is given.
   *
   * The seen-state only goes when the symbol has left the session entirely,
   * since it is keyed by symbol and still needed by any list that kept it.
   */
  removeFromWatchlist(sessionId: string, symbol: string, listId?: string | null): void {
    this.db.transaction(() => {
      if (listId != null) {
        this.db
          .prepare(
            "DELETE FROM watchlist_items WHERE session_id = ? AND symbol = ? AND list_id = ?",
          )
          .run(sessionId, symbol, listId);
      } else {
        this.db
          .prepare("DELETE FROM watchlist_items WHERE session_id = ? AND symbol = ?")
          .run(sessionId, symbol);
      }

      const still = this.db
        .prepare(
          "SELECT 1 FROM watchlist_items WHERE session_id = ? AND symbol = ? LIMIT 1",
        )
        .get(sessionId, symbol);
      if (!still) {
        this.db
          .prepare("DELETE FROM seen_state WHERE session_id = ? AND symbol = ?")
          .run(sessionId, symbol);
      }
    })();
  }

  /** The user's own stated position, which colours the wording but never the score. */
  setIntent(sessionId: string, listId: string, symbol: string, intent: Intent): boolean {
    const res = this.db
      .prepare(
        "UPDATE watchlist_items SET intent = ? WHERE session_id = ? AND list_id = ? AND symbol = ?",
      )
      .run(intent, sessionId, listId, symbol);
    return res.changes > 0;
  }

  /**
   * Advance the "seen" anchor.
   *
   * MAX() makes the write monotone, so it is idempotent and commutative:
   * acknowledgements arriving from two devices at once converge on the same
   * value regardless of order. No locks, no lost update — a join-semilattice
   * expressed in one statement.
   */
  acknowledge(sessionId: string, symbol: string, at: number): void {
    this.db
      .prepare(
        `INSERT INTO seen_state (session_id, symbol, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id, symbol) DO UPDATE
           SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
      )
      .run(sessionId, symbol, at);
  }

  // ─── Symbols ──────────────────────────────────────────────────────────────

  searchSymbols(query: string, limit = 8): SeedSymbol[] {
    const q = `%${query.trim().toLowerCase()}%`;
    return this.db
      .prepare(
        `SELECT symbol, name, sector FROM symbols
          WHERE sector != 'Index'
            AND (LOWER(symbol) LIKE ? OR LOWER(name) LIKE ? OR LOWER(sector) LIKE ?)
       ORDER BY LENGTH(name) ASC
          LIMIT ?`,
      )
      .all(q, q, q, limit) as SeedSymbol[];
  }

  // ─── Cross-device sync ────────────────────────────────────────────────────
  /** 128 bits. The blast radius is a list of tickers, but guessing one should
   *  still be infeasible rather than merely inconvenient. */
  issueSyncCode(sessionId: string): string {
    const existing = this.db
      .prepare("SELECT sync_code FROM sessions WHERE id = ?")
      .get(sessionId) as { sync_code: string | null } | undefined;
    if (existing?.sync_code) return existing.sync_code;

    const code = randomBytes(16).toString("base64url");
    this.db
      .prepare("UPDATE sessions SET sync_code = ? WHERE id = ?")
      .run(code, sessionId);
    return code;
  }

  redeemSyncCode(code: string): string | null {
    const row = this.db
      .prepare("SELECT id FROM sessions WHERE sync_code = ?")
      .get(code) as { id: string } | undefined;
    return row?.id ?? null;
  }

  close(): void {
    this.db.close();
  }
}
