import { Router } from 'express';
import {
  acceptFriendship,
  listFriends,
  listPendingRequests,
  removeFriendship,
  requestFriendship,
  visibilityFor,
} from '../domain/friends.js';
import { getUserByHandle, searchUsers, toPublicUser } from '../domain/users.js';
import { listItems, libraryStats } from '../domain/items.js';
import { MEDIA_TYPES, STATUSES } from '../domain/types.js';
import type { MediaType, Status } from '../domain/types.js';
import { forbidden, notFound } from '../lib/errors.js';
import { asObject, normalizeHandle, requireString } from '../lib/validate.js';
import { handler, requireAuth, type AppContext } from '../http/context.js';

export function friendRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/friends',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({
        friends: listFriends(ctx.db, user.id),
        requests: listPendingRequests(ctx.db, user.id),
      });
    }),
  );

  router.get(
    '/friends/search',
    handler((req, res) => {
      const user = requireAuth(req);
      const query = String(req.query.q ?? '').trim();
      if (query.length < 2) {
        res.json({ users: [] });
        return;
      }
      res.json({ users: searchUsers(ctx.db, query, user.id) });
    }),
  );

  router.post(
    '/friends/requests',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const handle = normalizeHandle(requireString(body, 'handle', 40));
      const target = getUserByHandle(ctx.db, handle);
      if (!target) throw notFound(`No one here goes by @${handle}`);
      res.status(201).json({ friendship: requestFriendship(ctx.db, user.id, target.id) });
    }),
  );

  router.post(
    '/friends/requests/:id/accept',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({ friendship: acceptFriendship(ctx.db, user.id, String(req.params.id)) });
    }),
  );

  router.delete(
    '/friends/:id',
    handler((req, res) => {
      const user = requireAuth(req);
      removeFriendship(ctx.db, user.id, String(req.params.id));
      res.json({ ok: true });
    }),
  );

  /** A friend's (or a public) library, filtered by what the viewer may see. */
  router.get(
    '/users/:handle',
    handler((req, res) => {
      const viewer = requireAuth(req);
      const owner = getUserByHandle(ctx.db, normalizeHandle(String(req.params.handle)));
      if (!owner) throw notFound('No such person');

      const level = visibilityFor(ctx.db, viewer.id, owner.id);
      if (!level) throw forbidden('This library is private');

      const mediaType = req.query.type as MediaType | undefined;
      const status = req.query.status as Status | undefined;
      const items = listItems(ctx.db, owner.id, {
        ...(mediaType && MEDIA_TYPES.includes(mediaType) ? { mediaType } : {}),
        ...(status && STATUSES.includes(status) ? { status } : {}),
        ...(req.query.q ? { search: String(req.query.q) } : {}),
        ...(level === 'owner' ? {} : { visibleTo: level }),
        limit: Math.min(Number(req.query.limit ?? 200) || 200, 500),
        offset: Math.max(Number(req.query.offset ?? 0) || 0, 0),
        sort: 'added_desc',
      });

      res.json({
        user: toPublicUser(owner),
        access: level,
        items,
        // Own stats only; a friend's totals shouldn't leak counts of items
        // they've chosen not to share.
        stats: level === 'owner' ? libraryStats(ctx.db, owner.id) : null,
      });
    }),
  );

  return router;
}
