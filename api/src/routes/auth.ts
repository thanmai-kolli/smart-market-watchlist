/**
 * Optional accounts.
 *
 * The product works before you ever see this, and that is the point: signing in
 * is a way to keep a list, not a gate in front of one. What it buys you over the
 * sync code is not having to move a code around, and a way back in from a device
 * you have never used.
 */
import { Router } from "express";
import type { Account } from "../../../shared/types.ts";
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  normaliseEmail,
  verifyPassword,
  wasteTime,
} from "../auth/password.ts";
import type { Store } from "../db/store.ts";
import { adoptSession } from "./session.ts";

/** Guessing a password should be slow enough not to be worth starting. */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60_000;

function credentials(body: unknown): { email: string; password: string } | null {
  const raw = body as { email?: unknown; password?: unknown } | null;
  if (typeof raw?.email !== "string" || typeof raw.password !== "string") return null;
  if (raw.password.length > 200) return null;

  const email = normaliseEmail(raw.email);
  return email ? { email, password: raw.password } : null;
}

export function authRoutes(store: Store): Router {
  const router = Router();

  // Held by the router rather than the module: one instance exists in the
  // server, and anything shared across every instance is state a test cannot
  // get out from under.
  const attempts = new Map<string, { count: number; resetAt: number }>();

  function tooManyAttempts(key: string): boolean {
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || now > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return false;
    }

    entry.count++;
    return entry.count > MAX_ATTEMPTS;
  }

  router.get("/auth/me", (req, res) => {
    res.json({ account: store.accountFor(req.sessionId) } satisfies Account);
  });

  router.post("/auth/register", async (req, res) => {
    if (tooManyAttempts(req.ip ?? "unknown")) {
      res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
      return;
    }

    const creds = credentials(req.body);
    if (!creds) {
      res.status(400).json({ error: "That does not look like an email address." });
      return;
    }
    if (creds.password.length < MIN_PASSWORD_LENGTH) {
      res
        .status(400)
        .json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }

    const userId = store.createUser(creds.email, await hashPassword(creds.password));
    if (!userId) {
      res.status(409).json({ error: "That email already has an account." });
      return;
    }

    // The list they built before signing up is the one they meant to keep.
    store.claimSession(req.sessionId, userId);
    res.json({ account: { id: userId, email: creds.email } } satisfies Account);
  });

  router.post("/auth/login", async (req, res) => {
    if (tooManyAttempts(req.ip ?? "unknown")) {
      res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
      return;
    }

    const creds = credentials(req.body);
    if (!creds) {
      res.status(400).json({ error: "That does not look like an email address." });
      return;
    }

    const user = store.findUser(creds.email);
    if (!user) {
      // Same wording and comparable timing as a wrong password, so this form
      // cannot be used to discover who has an account.
      await wasteTime();
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    if (!(await verifyPassword(creds.password, user.passwordHash))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }

    // Their saved list wins. Merging is not offered because there is no correct
    // merge, and silently combining two watchlists is a surprise nobody can undo.
    const saved = store.sessionForUser(user.id, req.sessionId);
    if (saved) {
      adoptSession(res, saved);
    } else {
      store.claimSession(req.sessionId, user.id);
    }

    res.json({ account: { id: user.id, email: creds.email } } satisfies Account);
  });

  router.post("/auth/logout", (req, res) => {
    // Unlinks rather than deletes: signing out is not the same as asking to be
    // forgotten, and the list has to be here when they come back.
    store.signOut(req.sessionId);
    res.json({ ok: true });
  });

  return router;
}
