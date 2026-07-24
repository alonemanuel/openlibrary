import type { Db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { notFound } from '../lib/errors.js';
import { recordEvent } from './events.js';
import type { Item, MediaType, Status, Visibility } from './types.js';

interface ItemRow {
  id: string;
  user_id: string;
  media_type: string;
  title: string;
  creators: string;
  year: number | null;
  status: string;
  rating: number | null;
  tags: string;
  notes: string;
  identifiers: string;
  cover_url: string | null;
  source: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    userId: row.user_id,
    mediaType: row.media_type as MediaType,
    title: row.title,
    creators: row.creators,
    year: row.year,
    status: row.status as Status,
    rating: row.rating,
    tags: safeParse<string[]>(row.tags, []),
    notes: row.notes,
    identifiers: safeParse<Record<string, string>>(row.identifiers, {}),
    coverUrl: row.cover_url,
    source: row.source,
    visibility: row.visibility as Visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export interface NewItemInput {
  mediaType: MediaType;
  title: string;
  creators?: string;
  year?: number | null;
  status?: Status;
  rating?: number | null;
  tags?: string[];
  notes?: string;
  identifiers?: Record<string, string>;
  coverUrl?: string | null;
  source?: string;
  visibility?: Visibility;
  /** Preserved on import so a re-import doesn't rewrite your history. */
  createdAt?: string;
}

export function createItem(
  db: Db,
  userId: string,
  input: NewItemInput,
  eventKind: 'created' | 'imported' = 'created',
): Item {
  const now = new Date().toISOString();
  const row: ItemRow = {
    id: newId('itm_'),
    user_id: userId,
    media_type: input.mediaType,
    title: input.title,
    creators: input.creators ?? '',
    year: input.year ?? null,
    status: input.status ?? 'liked',
    rating: input.rating ?? null,
    tags: JSON.stringify(input.tags ?? []),
    notes: input.notes ?? '',
    identifiers: JSON.stringify(input.identifiers ?? {}),
    cover_url: input.coverUrl ?? null,
    source: input.source ?? 'manual',
    visibility: input.visibility ?? 'friends',
    created_at: input.createdAt ?? now,
    updated_at: now,
    deleted_at: null,
  };

  db.prepare(
    `INSERT INTO items (id, user_id, media_type, title, creators, year, status, rating, tags, notes,
                        identifiers, cover_url, source, visibility, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.user_id,
    row.media_type,
    row.title,
    row.creators,
    row.year,
    row.status,
    row.rating,
    row.tags,
    row.notes,
    row.identifiers,
    row.cover_url,
    row.source,
    row.visibility,
    row.created_at,
    row.updated_at,
    row.deleted_at,
  );

  recordEvent(db, {
    itemId: row.id,
    userId,
    kind: eventKind,
    payload: { title: row.title, mediaType: row.media_type, source: row.source },
  });
  return rowToItem(row);
}

export function getItem(db: Db, itemId: string): Item | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function getOwnedItem(db: Db, userId: string, itemId: string): Item {
  const item = getItem(db, itemId);
  if (!item || item.userId !== userId) throw notFound('Item not found');
  return item;
}

export type ItemPatch = Partial<
  Pick<
    Item,
    | 'title'
    | 'creators'
    | 'year'
    | 'status'
    | 'rating'
    | 'tags'
    | 'notes'
    | 'identifiers'
    | 'coverUrl'
    | 'visibility'
    | 'mediaType'
  >
>;

const PATCH_COLUMNS: Record<keyof ItemPatch, string> = {
  title: 'title',
  creators: 'creators',
  year: 'year',
  status: 'status',
  rating: 'rating',
  tags: 'tags',
  notes: 'notes',
  identifiers: 'identifiers',
  coverUrl: 'cover_url',
  visibility: 'visibility',
  mediaType: 'media_type',
};

export function updateItem(db: Db, userId: string, itemId: string, patch: ItemPatch): Item {
  const existing = getOwnedItem(db, userId, itemId);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const changed: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof ItemPatch, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    const encoded =
      key === 'tags' || key === 'identifiers'
        ? JSON.stringify(value)
        : (value as string | number | null);
    sets.push(`${column} = ?`);
    values.push(encoded);
    changed[key] = value;
  }

  if (sets.length === 0) return existing;

  const now = new Date().toISOString();
  sets.push('updated_at = ?');
  values.push(now, itemId);
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  recordEvent(db, { itemId, userId, kind: 'updated', payload: { changed } });
  return getOwnedItem(db, userId, itemId);
}

/**
 * Deletes are always soft. The row stays, the event log records who removed it
 * and when, and `restoreItem` brings it back untouched.
 */
export function softDeleteItem(db: Db, userId: string, itemId: string): Item {
  const item = getOwnedItem(db, userId, itemId);
  if (item.deletedAt) return item;
  const now = new Date().toISOString();
  db.prepare('UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, itemId);
  recordEvent(db, { itemId, userId, kind: 'deleted', payload: { title: item.title } });
  return getOwnedItem(db, userId, itemId);
}

export function restoreItem(db: Db, userId: string, itemId: string): Item {
  const item = getOwnedItem(db, userId, itemId);
  if (!item.deletedAt) return item;
  const now = new Date().toISOString();
  db.prepare('UPDATE items SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, itemId);
  recordEvent(db, { itemId, userId, kind: 'restored', payload: { title: item.title } });
  return getOwnedItem(db, userId, itemId);
}

export interface ItemQuery {
  mediaType?: MediaType;
  status?: Status;
  tag?: string;
  search?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
  /** Restricts to items at least as visible as the given level. */
  visibleTo?: 'friends' | 'public';
  limit?: number;
  offset?: number;
  sort?: 'added_desc' | 'added_asc' | 'title' | 'rating' | 'year';
}

const SORTS: Record<NonNullable<ItemQuery['sort']>, string> = {
  added_desc: 'created_at DESC, id DESC',
  added_asc: 'created_at ASC, id ASC',
  title: 'title COLLATE NOCASE ASC',
  rating: 'rating DESC NULLS LAST, title COLLATE NOCASE ASC',
  year: 'year DESC NULLS LAST, title COLLATE NOCASE ASC',
};

function buildWhere(userId: string, query: ItemQuery): { sql: string; params: (string | number)[] } {
  const clauses = ['user_id = ?'];
  const params: (string | number)[] = [userId];

  if (query.onlyDeleted) clauses.push('deleted_at IS NOT NULL');
  else if (!query.includeDeleted) clauses.push('deleted_at IS NULL');

  if (query.mediaType) {
    clauses.push('media_type = ?');
    params.push(query.mediaType);
  }
  if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }
  if (query.tag) {
    // tags are stored as a JSON array of lowercase strings
    clauses.push('EXISTS (SELECT 1 FROM json_each(items.tags) WHERE json_each.value = ?)');
    params.push(query.tag.toLowerCase());
  }
  if (query.search) {
    clauses.push('(lower(title) LIKE ? OR lower(creators) LIKE ? OR lower(notes) LIKE ?)');
    const like = `%${query.search.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (query.visibleTo === 'public') clauses.push("visibility = 'public'");
  else if (query.visibleTo === 'friends') clauses.push("visibility IN ('public', 'friends')");

  return { sql: clauses.join(' AND '), params };
}

export function listItems(db: Db, userId: string, query: ItemQuery = {}): Item[] {
  const { sql, params } = buildWhere(userId, query);
  const order = SORTS[query.sort ?? 'added_desc'];
  const limit = Math.min(query.limit ?? 200, 1000);
  const offset = Math.max(query.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM items WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as ItemRow[];
  return rows.map(rowToItem);
}

export function countItems(db: Db, userId: string, query: ItemQuery = {}): number {
  const { sql, params } = buildWhere(userId, query);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${sql}`).get(...params) as {
    n: number;
  };
  return Number(row.n);
}

export interface LibraryStats {
  total: number;
  deleted: number;
  byMediaType: Record<string, number>;
  byStatus: Record<string, number>;
  topTags: { tag: string; count: number }[];
}

export function libraryStats(db: Db, userId: string): LibraryStats {
  const byMediaType: Record<string, number> = {};
  for (const row of db
    .prepare(
      'SELECT media_type, COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL GROUP BY media_type',
    )
    .all(userId) as { media_type: string; n: number }[]) {
    byMediaType[row.media_type] = Number(row.n);
  }

  const byStatus: Record<string, number> = {};
  for (const row of db
    .prepare(
      'SELECT status, COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL GROUP BY status',
    )
    .all(userId) as { status: string; n: number }[]) {
    byStatus[row.status] = Number(row.n);
  }

  const topTags = (
    db
      .prepare(
        `SELECT json_each.value AS tag, COUNT(*) AS n
         FROM items, json_each(items.tags)
         WHERE items.user_id = ? AND items.deleted_at IS NULL
         GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 12`,
      )
      .all(userId) as { tag: string; n: number }[]
  ).map((row) => ({ tag: row.tag, count: Number(row.n) }));

  return {
    total: countItems(db, userId),
    deleted: countItems(db, userId, { onlyDeleted: true }),
    byMediaType,
    byStatus,
    topTags,
  };
}

/**
 * Finds an existing (non-deleted) item that represents the same work, so that
 * adding from a catalog twice — or re-importing an export — updates instead of
 * duplicating. Matches on any shared external identifier first, then falls back
 * to a normalized title+type+year match.
 */
export function findDuplicate(db: Db, userId: string, candidate: NewItemInput): Item | null {
  const identifiers = Object.entries(candidate.identifiers ?? {});
  for (const [key, value] of identifiers) {
    if (!value) continue;
    const row = db
      .prepare(
        `SELECT * FROM items
         WHERE user_id = ? AND deleted_at IS NULL AND media_type = ?
           AND json_extract(identifiers, '$.' || ?) = ?
         LIMIT 1`,
      )
      .get(userId, candidate.mediaType, key, value) as ItemRow | undefined;
    if (row) return rowToItem(row);
  }

  const normalizedTitle = candidate.title.trim().toLowerCase();
  const row = db
    .prepare(
      `SELECT * FROM items
       WHERE user_id = ? AND deleted_at IS NULL AND media_type = ?
         AND lower(trim(title)) = ?
         AND (year IS ? OR ? IS NULL)
       LIMIT 1`,
    )
    .get(
      userId,
      candidate.mediaType,
      normalizedTitle,
      candidate.year ?? null,
      candidate.year ?? null,
    ) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}
