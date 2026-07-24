import { Router } from 'express';
import {
  countItems,
  createItem,
  findDuplicate,
  getOwnedItem,
  libraryStats,
  listItems,
  restoreItem,
  softDeleteItem,
  updateItem,
  type ItemQuery,
} from '../domain/items.js';
import { listItemEvents, listUserEvents } from '../domain/events.js';
import { MEDIA_TYPES, STATUSES, VISIBILITIES } from '../domain/types.js';
import type { MediaType, Status } from '../domain/types.js';
import { badRequest } from '../lib/errors.js';
import {
  asObject,
  optionalIdentifiers,
  optionalInt,
  optionalString,
  optionalTags,
  optionalEnum,
  requireEnum,
  requireString,
} from '../lib/validate.js';
import { handler, requireAuth, type AppContext } from '../http/context.js';

function parseQuery(query: Record<string, unknown>): ItemQuery {
  const mediaType = query.type as MediaType | undefined;
  const status = query.status as Status | undefined;
  const sortRaw = String(query.sort ?? 'added_desc');
  const sort = (['added_desc', 'added_asc', 'title', 'rating', 'year'] as const).includes(
    sortRaw as never,
  )
    ? (sortRaw as ItemQuery['sort'])
    : 'added_desc';

  return {
    ...(mediaType && MEDIA_TYPES.includes(mediaType) ? { mediaType } : {}),
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(query.tag ? { tag: String(query.tag) } : {}),
    ...(query.q ? { search: String(query.q) } : {}),
    onlyDeleted: query.deleted === '1' || query.deleted === 'true',
    sort,
    limit: Math.min(Number(query.limit ?? 100) || 100, 500),
    offset: Math.max(Number(query.offset ?? 0) || 0, 0),
  };
}

export function itemRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/items',
    handler((req, res) => {
      const user = requireAuth(req);
      const query = parseQuery(req.query as Record<string, unknown>);
      res.json({
        items: listItems(ctx.db, user.id, query),
        total: countItems(ctx.db, user.id, query),
      });
    }),
  );

  router.post(
    '/items',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const input = {
        mediaType: requireEnum(body, 'mediaType', MEDIA_TYPES),
        title: requireString(body, 'title', 300),
        creators: optionalString(body, 'creators', 300) ?? '',
        year: (optionalInt(body, 'year', 0, 2999) ?? null) as number | null,
        status: optionalEnum(body, 'status', STATUSES) ?? 'liked',
        rating: (optionalInt(body, 'rating', 0, 10) ?? null) as number | null,
        tags: optionalTags(body, 'tags') ?? [],
        notes: optionalString(body, 'notes', 10000) ?? '',
        identifiers: optionalIdentifiers(body, 'identifiers') ?? {},
        coverUrl: optionalString(body, 'coverUrl', 1000) ?? null,
        source: optionalString(body, 'source', 40) ?? 'manual',
        visibility: optionalEnum(body, 'visibility', VISIBILITIES) ?? 'friends',
      };

      // Adding the same thing twice is a mistake, not an intent: return the
      // existing item so the client can highlight it.
      const duplicate = findDuplicate(ctx.db, user.id, input);
      if (duplicate) {
        res.status(200).json({ item: duplicate, duplicate: true });
        return;
      }
      res.status(201).json({ item: createItem(ctx.db, user.id, input), duplicate: false });
    }),
  );

  router.get(
    '/items/:id',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({ item: getOwnedItem(ctx.db, user.id, String(req.params.id)) });
    }),
  );

  router.patch(
    '/items/:id',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const patch = {
        ...(body.title !== undefined ? { title: requireString(body, 'title', 300) } : {}),
        ...(body.creators !== undefined ? { creators: optionalString(body, 'creators', 300) } : {}),
        ...(body.year !== undefined ? { year: optionalInt(body, 'year', 0, 2999) } : {}),
        ...(body.status !== undefined ? { status: requireEnum(body, 'status', STATUSES) } : {}),
        ...(body.rating !== undefined ? { rating: optionalInt(body, 'rating', 0, 10) } : {}),
        ...(body.tags !== undefined ? { tags: optionalTags(body, 'tags') } : {}),
        ...(body.notes !== undefined ? { notes: optionalString(body, 'notes', 10000) } : {}),
        ...(body.identifiers !== undefined
          ? { identifiers: optionalIdentifiers(body, 'identifiers') }
          : {}),
        ...(body.coverUrl !== undefined ? { coverUrl: optionalString(body, 'coverUrl', 1000) } : {}),
        ...(body.visibility !== undefined
          ? { visibility: requireEnum(body, 'visibility', VISIBILITIES) }
          : {}),
        ...(body.mediaType !== undefined
          ? { mediaType: requireEnum(body, 'mediaType', MEDIA_TYPES) }
          : {}),
      };
      res.json({ item: updateItem(ctx.db, user.id, String(req.params.id), patch) });
    }),
  );

  router.delete(
    '/items/:id',
    handler((req, res) => {
      const user = requireAuth(req);
      // Soft delete: the item stays in the export with a deleted_at stamp.
      res.json({ item: softDeleteItem(ctx.db, user.id, String(req.params.id)) });
    }),
  );

  router.post(
    '/items/:id/restore',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({ item: restoreItem(ctx.db, user.id, String(req.params.id)) });
    }),
  );

  router.get(
    '/items/:id/history',
    handler((req, res) => {
      const user = requireAuth(req);
      const item = getOwnedItem(ctx.db, user.id, String(req.params.id));
      res.json({ events: listItemEvents(ctx.db, item.id) });
    }),
  );

  router.post(
    '/items/bulk',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (ids.length === 0) throw badRequest('"ids" must be a non-empty array');
      if (ids.length > 500) throw badRequest('Bulk operations are limited to 500 items');
      const action = requireEnum(body, 'action', ['delete', 'restore', 'set_status', 'set_visibility', 'add_tag'] as const);

      let changed = 0;
      for (const id of ids) {
        if (action === 'delete') softDeleteItem(ctx.db, user.id, id);
        else if (action === 'restore') restoreItem(ctx.db, user.id, id);
        else if (action === 'set_status') {
          updateItem(ctx.db, user.id, id, { status: requireEnum(body, 'status', STATUSES) });
        } else if (action === 'set_visibility') {
          updateItem(ctx.db, user.id, id, { visibility: requireEnum(body, 'visibility', VISIBILITIES) });
        } else {
          const tag = requireString(body, 'tag', 40).toLowerCase();
          const item = getOwnedItem(ctx.db, user.id, id);
          updateItem(ctx.db, user.id, id, { tags: [...new Set([...item.tags, tag])] });
        }
        changed += 1;
      }
      res.json({ changed });
    }),
  );

  router.get(
    '/stats',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({ stats: libraryStats(ctx.db, user.id) });
    }),
  );

  router.get(
    '/activity',
    handler((req, res) => {
      const user = requireAuth(req);
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      res.json({ events: listUserEvents(ctx.db, user.id, limit) });
    }),
  );

  return router;
}
