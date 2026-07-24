import { Router } from 'express';
import {
  authenticate,
  createSession,
  createUser,
  destroySession,
  setLibraryVisibility,
  toPublicUser,
} from '../domain/users.js';
import { VISIBILITIES } from '../domain/types.js';
import { badRequest } from '../lib/errors.js';
import {
  asObject,
  normalizeHandle,
  optionalEnum,
  optionalString,
  requireEmail,
  requireString,
} from '../lib/validate.js';
import {
  clearSessionCookie,
  handler,
  requireAuth,
  setSessionCookie,
  type AppContext,
} from '../http/context.js';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post(
    '/register',
    handler((req, res) => {
      const body = asObject(req.body);
      const email = requireEmail(body);
      const password = requireString(body, 'password', 200);
      if (password.length < 8) throw badRequest('Password must be at least 8 characters');
      const handle = normalizeHandle(requireString(body, 'handle', 40));
      const displayName = optionalString(body, 'displayName', 80) || handle;

      const user = createUser(ctx.db, { email, handle, displayName, password });
      const session = createSession(ctx.db, user.id, ctx.config.sessionTtlMs);
      setSessionCookie(res, session.id, session.expiresAt);
      res.status(201).json({ user: { ...toPublicUser(user), email: user.email } });
    }),
  );

  router.post(
    '/login',
    handler((req, res) => {
      const body = asObject(req.body);
      const email = requireEmail(body);
      const password = requireString(body, 'password', 200);
      const user = authenticate(ctx.db, email, password);
      const session = createSession(ctx.db, user.id, ctx.config.sessionTtlMs);
      setSessionCookie(res, session.id, session.expiresAt);
      res.json({ user: { ...toPublicUser(user), email: user.email } });
    }),
  );

  router.post(
    '/logout',
    handler((req, res) => {
      if (req.sessionId) destroySession(ctx.db, req.sessionId);
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/me',
    handler((req, res) => {
      if (!req.user) {
        res.json({ user: null });
        return;
      }
      res.json({ user: { ...toPublicUser(req.user), email: req.user.email } });
    }),
  );

  router.patch(
    '/me',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const visibility = optionalEnum(body, 'libraryVisibility', VISIBILITIES);
      if (visibility) setLibraryVisibility(ctx.db, user.id, visibility);
      const displayName = optionalString(body, 'displayName', 80);
      if (displayName) {
        ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
      }
      const updated = ctx.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(user.id) as { display_name: string; library_visibility: string };
      res.json({
        user: {
          id: user.id,
          handle: user.handle,
          email: user.email,
          displayName: updated.display_name,
          libraryVisibility: updated.library_visibility,
        },
      });
    }),
  );

  return router;
}
