/**
 * Accounts, and what they must refuse.
 *
 * Sign-in is optional here, but the moment it exists it becomes the most
 * attackable surface in the product, so the interesting tests are the refusals
 * rather than the happy path.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  hashPassword,
  normaliseEmail,
  verifyPassword,
} from "../src/auth/password.ts";
import { Store } from "../src/db/store.ts";
import { authRoutes } from "../src/routes/auth.ts";

const dir = mkdtempSync(join(tmpdir(), "meanwhile-auth-"));
const store = new Store(join(dir, "a.db"));

after(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function serve(sessionId: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { sessionId: string }).sessionId = sessionId;
    next();
  });
  app.use("/api", authRoutes(store));
  return app;
}

async function post(
  app: express.Express,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

test("a password is never stored in a form that can be read back", async () => {
  const stored = await hashPassword("correct horse battery staple");

  assert.ok(!stored.includes("correct"));
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.ok(await verifyPassword("correct horse battery staple", stored));
  assert.ok(!(await verifyPassword("Correct horse battery staple", stored)));
});

test("the same password hashes differently every time", async () => {
  const a = await hashPassword("same input");
  const b = await hashPassword("same input");

  assert.notEqual(a, b, "a shared salt would let one crack answer for everybody");
  assert.ok(await verifyPassword("same input", a));
  assert.ok(await verifyPassword("same input", b));
});

test("a malformed hash is rejected rather than throwing", async () => {
  for (const junk of ["", "nope", "no-colon-here", ":", "aa:"]) {
    assert.equal(await verifyPassword("anything", junk), false, junk);
  }
});

test("email is normalised, and nonsense is refused", () => {
  assert.equal(normaliseEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normaliseEmail("no-at-sign"), null);
  assert.equal(normaliseEmail("two@@at.com"), null);
  assert.equal(normaliseEmail("missing@domain"), null);
  assert.equal(normaliseEmail(`${"a".repeat(250)}@example.com`), null);
});

test("signing up claims the list you already had", async () => {
  const session = store.createSession();
  const before = store.getWatchlist(session).length;

  const res = await post(serve(session), "/api/auth/register", {
    email: "claimer@example.com",
    password: "a good long password",
  });

  assert.equal(res.status, 200);
  assert.equal(store.getWatchlist(session).length, before);
  assert.equal(store.accountFor(session)?.email, "claimer@example.com");
});

test("an email cannot be registered twice", async () => {
  await post(serve(store.createSession()), "/api/auth/register", {
    email: "taken@example.com",
    password: "a good long password",
  });
  const second = await post(serve(store.createSession()), "/api/auth/register", {
    email: "taken@example.com",
    password: "a different long password",
  });

  assert.equal(second.status, 409);
});

test("a short password is refused", async () => {
  const res = await post(serve(store.createSession()), "/api/auth/register", {
    email: "short@example.com",
    password: "1234567",
  });

  assert.equal(res.status, 400);
  assert.equal(store.findUser("short@example.com"), null);
});

test("a wrong password and an unknown address are indistinguishable", async () => {
  await post(serve(store.createSession()), "/api/auth/register", {
    email: "real@example.com",
    password: "a good long password",
  });

  const wrongPassword = await post(serve(store.createSession()), "/api/auth/login", {
    email: "real@example.com",
    password: "not the password",
  });
  const noSuchUser = await post(serve(store.createSession()), "/api/auth/login", {
    email: "ghost@example.com",
    password: "not the password",
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.deepEqual(
    wrongPassword.body,
    noSuchUser.body,
    "differing replies would turn this form into a way to enumerate accounts",
  );
});

test("signing in returns the list the account already had, not the new one", async () => {
  const first = store.createSession();
  await post(serve(first), "/api/auth/register", {
    email: "returning@example.com",
    password: "a good long password",
  });
  store.addToWatchlist(first, "WIPRO.NS");

  const fresh = store.createSession();
  const res = await post(serve(fresh), "/api/auth/login", {
    email: "returning@example.com",
    password: "a good long password",
  });

  assert.equal(res.status, 200);
  assert.equal(
    store.sessionForUser(store.findUser("returning@example.com")!.id, fresh),
    first,
  );
  assert.ok(store.getWatchlist(first).some((r) => r.symbol === "WIPRO.NS"));
});

test("signing out keeps the list; forgetting takes the account with it", async () => {
  const session = store.createSession();
  await post(serve(session), "/api/auth/register", {
    email: "leaving@example.com",
    password: "a good long password",
  });

  store.signOut(session);
  assert.equal(store.accountFor(session), null);
  assert.ok(store.getWatchlist(session).length > 0, "signing out is not deletion");

  const second = store.createSession();
  await post(serve(second), "/api/auth/login", {
    email: "leaving@example.com",
    password: "a good long password",
  });
  store.forget(second);

  assert.equal(store.findUser("leaving@example.com"), null);
});

test("a signed-in list survives the sweep that clears abandoned ones", async () => {
  const anon = store.createSession();
  const owned = store.createSession();
  await post(serve(owned), "/api/auth/register", {
    email: "keeper@example.com",
    password: "a good long password",
  });

  store.sweepStaleSessions(-1);

  assert.equal(store.sessionExists(anon), false);
  assert.equal(store.sessionExists(owned), true);
});

test("a database left over from the abandoned Google sign-in still works", async () => {
  const legacyDir = mkdtempSync(join(tmpdir(), "meanwhile-legacy-auth-"));
  const path = join(legacyDir, "legacy.db");

  // Exactly the shape that shipped before accounts were removed: a users table
  // with no password column, which CREATE TABLE IF NOT EXISTS will not replace.
  const raw = new Database(path);
  raw.exec(
    `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, created_at INTEGER NOT NULL, picture TEXT);
     CREATE TABLE sessions (id TEXT PRIMARY KEY, sync_code TEXT UNIQUE, created_at INTEGER NOT NULL, user_id TEXT)`,
  );
  raw
    .prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)")
    .run("old-user", "google@example.com", "From Google", Date.now());
  raw.close();

  const legacy = new Store(path);
  try {
    const session = legacy.createSession();
    const res = await post(
      (() => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          (req as express.Request & { sessionId: string }).sessionId = session;
          next();
        });
        app.use("/api", authRoutes(legacy));
        return app;
      })(),
      "/api/auth/register",
      { email: "new@example.com", password: "a good long password" },
    );

    assert.equal(res.status, 200, "registering must not fail on an upgraded database");
    assert.equal(legacy.accountFor(session)?.email, "new@example.com");
    assert.equal(
      legacy.findUser("google@example.com"),
      null,
      "an account with no password cannot be signed into and must not survive",
    );
  } finally {
    legacy.close();
    rmSync(legacyDir, { recursive: true, force: true });
  }
});
