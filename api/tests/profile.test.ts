/**
 * Naming yourself is a convenience, not an identity check.
 *
 * The name exists so two lists can be told apart after a sync. It protects
 * nothing, so the only things worth pinning down are that it cannot be used to
 * reach another session and cannot grow without bound.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Store } from "../src/db/store.ts";

const dir = mkdtempSync(join(tmpdir(), "meanwhile-profile-"));
const store = new Store(join(dir, "p.db"));

after(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a session starts unnamed and keeps whatever it is given", () => {
  const id = store.createSession();

  assert.equal(store.displayName(id), null);
  assert.equal(store.setDisplayName(id, "Thanmai"), "Thanmai");
  assert.equal(store.displayName(id), "Thanmai");
});

test("clearing the name is allowed, and stores nothing rather than blank", () => {
  const id = store.createSession();
  store.setDisplayName(id, "Someone");

  assert.equal(store.setDisplayName(id, "   "), null);
  assert.equal(store.displayName(id), null);
});

test("a name is trimmed and capped, so it cannot be used as storage", () => {
  const id = store.createSession();

  assert.equal(store.setDisplayName(id, "  spaced  "), "spaced");
  assert.equal(store.setDisplayName(id, "x".repeat(500))?.length, 32);
});

test("naming yourself does not touch anybody else", () => {
  const mine = store.createSession();
  const theirs = store.createSession();

  store.setDisplayName(mine, "Mine");

  assert.equal(store.displayName(theirs), null);
});

test("forgetting takes the name with it", () => {
  const id = store.createSession();
  store.setDisplayName(id, "Temporary");

  store.forget(id);

  assert.equal(store.displayName(id), null);
  assert.equal(store.sessionExists(id), false);
});
