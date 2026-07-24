import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import type { User } from '../domain/types.js';
import { getSessionUser } from '../domain/users.js';
import { unauthorized } from '../lib/errors.js';

export interface AppContext {
  db: Db;
  config: Config;
  /** Injected so tests (and offline mode) never hit the network. */
  fetchImpl: typeof fetch;
}

export const SESSION_COOKIE = 'ol_session';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(
      expiresAt,
    ).toUTCString()}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

export interface AuthedRequest extends Request {
  user?: User;
  sessionId?: string;
}

/** Attaches `req.user` when a valid session cookie is present. Never rejects. */
export function withUser(ctx: AppContext): RequestHandler {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sessionId) {
      const user = getSessionUser(ctx.db, sessionId);
      if (user) {
        req.user = user;
        req.sessionId = sessionId;
      }
    }
    next();
  };
}

export function requireAuth(req: AuthedRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Wraps an async handler so rejections reach the error middleware. */
export function handler(
  fn: (req: AuthedRequest, res: Response) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res)).catch(next);
  };
}
