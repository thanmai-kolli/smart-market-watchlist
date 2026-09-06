import { Router } from "express";
import type { SyncCodeResponse } from "../../../shared/types.ts";
import type { Store } from "../db/store.ts";
import { adoptSession } from "./session.ts";

/**
 * Cross-device continuity without accounts.
 *
 * The brief asks for state that persists across sessions and devices. A login
 * would satisfy that, but it puts a wall between someone and the product, and a
 * public repository cannot ship OAuth credentials. A one-time code carries the
 * session to another device and costs nothing to not use.
 */

/** A sync code is a bearer token: possession is authorisation, so brute force must be slow. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60_000;

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

export function syncRoutes(store: Store): Router {
  const router = Router();

  router.post("/sync/code", (req, res) => {
    const code = store.issueSyncCode(req.sessionId);
    res.json({ code } satisfies SyncCodeResponse);
  });

  router.post("/sync/redeem", (req, res) => {
    if (tooManyAttempts(req.ip ?? "unknown")) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }

    const code = (req.body as { code?: unknown })?.code;
    if (typeof code !== "string" || code.length < 8 || code.length > 64) {
      res.status(400).json({ error: "Invalid code" });
      return;
    }

    const sessionId = store.redeemSyncCode(code.trim());
    if (!sessionId) {
      res.status(404).json({ error: "That code doesn't match any watchlist" });
      return;
    }

    // Adopting rather than merging: two lists silently combining would be a
    // surprise the user cannot undo, and there is no obvious correct merge.
    adoptSession(res, sessionId);
    res.json({ ok: true });
  });

  return router;
}
