import type { Request, Response, NextFunction } from "express";
import type { Store } from "../db/store.ts";

const COOKIE = "wl_session";
const ONE_YEAR_MS = 365 * 86_400_000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionId: string;
    }
  }
}

/**
 * Anonymous session, created on first request.
 *
 * No signup wall: the app is usable the instant it loads. Sign-in could be added
 * later as an enhancement, but it can never be a prerequisite — a login screen
 * is a wall between someone and the thing you want them to see.
 */
export function sessionMiddleware(store: Store) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const existing = req.cookies?.[COOKIE] as string | undefined;

    if (existing && store.sessionExists(existing)) {
      req.sessionId = existing;
      store.touchSession(existing);
      next();
      return;
    }

    const id = store.createSession();
    res.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR_MS,
    });
    req.sessionId = id;
    next();
  };
}

export function adoptSession(res: Response, id: string): void {
  res.cookie(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_MS,
  });
}
