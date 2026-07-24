import type { Db } from '../db/index.js';
import { createItem, findDuplicate, updateItem, type NewItemInput } from '../domain/items.js';
import { MEDIA_TYPES, STATUSES, VISIBILITIES } from '../domain/types.js';
import type { MediaType, Status, Visibility } from '../domain/types.js';
import { badRequest } from '../lib/errors.js';
import { parseCsvRecords } from './csv.js';

export type ImportFormat = 'openlibrary' | 'goodreads' | 'letterboxd' | 'generic';

export interface ImportResult {
  format: ImportFormat;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface ImportOptions {
  /** Forced media type, used by the generic mapper when the file doesn't say. */
  mediaType?: MediaType;
  /** Update items that already exist instead of leaving them untouched. */
  updateExisting?: boolean;
  defaultVisibility?: Visibility;
}

/** Undoes the spreadsheet formula guard added on export. */
function unguard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function pick(record: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = record[key];
    if (direct) return unguard(direct.trim());
    const found = Object.keys(record).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found && record[found]) return unguard(record[found]!.trim());
  }
  return '';
}

function parseYear(value: string): number | null {
  const match = value.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 2999 ? year : null;
}

function parseTags(value: string): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[;,|]/)
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 40),
    ),
  ].slice(0, 50);
}

function parseIdentifiers(value: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
        if (raw !== null && raw !== undefined && raw !== '') out[key] = String(raw);
      }
      return out;
    }
  } catch {
    /* fall through — treat as a bare id below */
  }
  return {};
}

/** Goodreads exports ISBNs as `="9780123456789"`. */
function cleanIsbn(value: string): string {
  return value.replace(/^="?/, '').replace(/"$/, '').trim();
}

export function detectFormat(headers: string[]): ImportFormat {
  const lower = headers.map((header) => header.trim().toLowerCase());
  const has = (name: string) => lower.includes(name);
  if (has('media_type') && has('title') && has('created_at')) return 'openlibrary';
  if (has('book id') || (has('exclusive shelf') && has('title'))) return 'goodreads';
  if (has('letterboxd uri') || (has('name') && has('year') && has('date') && !has('media_type'))) {
    return 'letterboxd';
  }
  return 'generic';
}

const GOODREADS_SHELF_TO_STATUS: Record<string, Status> = {
  read: 'done',
  'currently-reading': 'in_progress',
  'to-read': 'want',
  abandoned: 'dropped',
};

function mapOpenLibrary(record: Record<string, string>, options: ImportOptions): NewItemInput {
  const mediaType = pick(record, 'media_type') as MediaType;
  const status = pick(record, 'status') as Status;
  const visibility = pick(record, 'visibility') as Visibility;
  const rating = Number(pick(record, 'rating'));
  const createdAt = pick(record, 'created_at');
  return {
    mediaType: MEDIA_TYPES.includes(mediaType) ? mediaType : (options.mediaType ?? 'book'),
    title: pick(record, 'title'),
    creators: pick(record, 'creators'),
    year: parseYear(pick(record, 'year')),
    status: STATUSES.includes(status) ? status : 'liked',
    rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating) : null,
    tags: parseTags(pick(record, 'tags')),
    notes: pick(record, 'notes'),
    identifiers: parseIdentifiers(pick(record, 'identifiers')),
    coverUrl: pick(record, 'cover_url') || null,
    source: pick(record, 'source') || 'import',
    visibility: VISIBILITIES.includes(visibility)
      ? visibility
      : (options.defaultVisibility ?? 'friends'),
    ...(createdAt ? { createdAt } : {}),
  };
}

function mapGoodreads(record: Record<string, string>, options: ImportOptions): NewItemInput {
  const shelf = pick(record, 'Exclusive Shelf').toLowerCase();
  const rating = Number(pick(record, 'My Rating'));
  const isbn13 = cleanIsbn(pick(record, 'ISBN13'));
  const isbn = cleanIsbn(pick(record, 'ISBN'));
  const goodreadsId = pick(record, 'Book Id');
  const shelves = parseTags(pick(record, 'Bookshelves'));

  const identifiers: Record<string, string> = {};
  if (isbn13) identifiers.isbn13 = isbn13;
  if (isbn) identifiers.isbn = isbn;
  if (goodreadsId) identifiers.goodreads = goodreadsId;

  return {
    mediaType: 'book',
    title: pick(record, 'Title'),
    creators: pick(record, 'Author l-f') || pick(record, 'Author'),
    year: parseYear(pick(record, 'Original Publication Year', 'Year Published')),
    // Goodreads' 5-star scale is stored on our 10-point scale.
    status: GOODREADS_SHELF_TO_STATUS[shelf] ?? 'liked',
    rating: Number.isFinite(rating) && rating > 0 ? rating * 2 : null,
    tags: shelves,
    notes: pick(record, 'My Review'),
    identifiers,
    source: 'goodreads',
    visibility: options.defaultVisibility ?? 'friends',
  };
}

function mapLetterboxd(record: Record<string, string>, options: ImportOptions): NewItemInput {
  const rating = Number(pick(record, 'Rating'));
  const uri = pick(record, 'Letterboxd URI');
  const identifiers: Record<string, string> = {};
  if (uri) identifiers.letterboxd = uri;

  return {
    mediaType: 'movie',
    title: pick(record, 'Name', 'Title'),
    creators: pick(record, 'Director'),
    year: parseYear(pick(record, 'Year')),
    status: 'done',
    rating: Number.isFinite(rating) && rating > 0 ? rating * 2 : null,
    tags: parseTags(pick(record, 'Tags')),
    notes: pick(record, 'Review'),
    identifiers,
    source: 'letterboxd',
    visibility: options.defaultVisibility ?? 'friends',
  };
}

/**
 * Best-effort mapping for "some CSV a service handed me" — the common case when
 * leaving a platform that doesn't document its export.
 */
function mapGeneric(record: Record<string, string>, options: ImportOptions): NewItemInput {
  const rating = Number(pick(record, 'rating', 'my rating', 'score', 'stars'));
  const isrc = pick(record, 'isrc');
  const spotifyId = pick(record, 'spotify track id', 'track uri', 'spotify id');
  const imdb = pick(record, 'imdb id', 'imdb');
  const isbn = cleanIsbn(pick(record, 'isbn13', 'isbn'));

  const identifiers: Record<string, string> = {};
  if (isrc) identifiers.isrc = isrc;
  if (spotifyId) identifiers.spotify = spotifyId;
  if (imdb) identifiers.imdb = imdb;
  if (isbn) identifiers.isbn = isbn;

  const inferredType: MediaType =
    options.mediaType ?? (isbn ? 'book' : imdb ? 'movie' : isrc || spotifyId ? 'music' : 'book');

  return {
    mediaType: inferredType,
    title: pick(record, 'title', 'name', 'track name', 'album', 'book'),
    creators: pick(record, 'creators', 'artist', 'artist name(s)', 'author', 'director'),
    year: parseYear(pick(record, 'year', 'release date', 'added at', 'date')),
    status: 'liked',
    rating: Number.isFinite(rating) && rating > 0 ? Math.min(Math.round(rating * 2), 10) : null,
    tags: parseTags(pick(record, 'tags', 'genres', 'bookshelves')),
    notes: pick(record, 'notes', 'review', 'comment'),
    identifiers,
    source: 'import',
    visibility: options.defaultVisibility ?? 'friends',
  };
}

const MAPPERS: Record<
  ImportFormat,
  (record: Record<string, string>, options: ImportOptions) => NewItemInput
> = {
  openlibrary: mapOpenLibrary,
  goodreads: mapGoodreads,
  letterboxd: mapLetterboxd,
  generic: mapGeneric,
};

function ingest(
  db: Db,
  userId: string,
  candidates: NewItemInput[],
  options: ImportOptions,
  format: ImportFormat,
): ImportResult {
  const result: ImportResult = { format, created: 0, updated: 0, skipped: 0, errors: [] };

  candidates.forEach((candidate, index) => {
    try {
      if (!candidate.title) {
        result.skipped += 1;
        return;
      }
      const existing = findDuplicate(db, userId, candidate);
      if (existing) {
        if (options.updateExisting) {
          updateItem(db, userId, existing.id, {
            title: candidate.title,
            creators: candidate.creators ?? existing.creators,
            year: candidate.year ?? existing.year,
            status: candidate.status ?? existing.status,
            rating: candidate.rating ?? existing.rating,
            tags: [...new Set([...existing.tags, ...(candidate.tags ?? [])])],
            notes: candidate.notes || existing.notes,
            identifiers: { ...existing.identifiers, ...(candidate.identifiers ?? {}) },
          });
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
        return;
      }
      createItem(db, userId, candidate, 'imported');
      result.created += 1;
    } catch (err) {
      // +2 accounts for the header row and 1-based row numbering, so the
      // reported line matches what the user sees in their spreadsheet.
      result.errors.push({ row: index + 2, message: (err as Error).message });
    }
  });

  return result;
}

export function importCsv(
  db: Db,
  userId: string,
  csvText: string,
  options: ImportOptions = {},
): ImportResult {
  const records = parseCsvRecords(csvText);
  if (records.length === 0) throw badRequest('That file has no data rows');
  const format = detectFormat(Object.keys(records[0]!));
  const mapper = MAPPERS[format];
  return ingest(
    db,
    userId,
    records.map((record) => mapper(record, options)),
    options,
    format,
  );
}

/** Imports a `library.json` produced by our own exporter. */
export function importJson(
  db: Db,
  userId: string,
  jsonText: string,
  options: ImportOptions = {},
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw badRequest('That file is not valid JSON');
  }
  const items =
    Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items) ?
      (parsed as { items: unknown[] }).items
    : null;
  if (!items) throw badRequest('Expected a JSON array of items, or an export with an "items" array');

  const candidates: NewItemInput[] = items.map((raw) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const mediaType = String(record.mediaType ?? record.media_type ?? '') as MediaType;
    const status = String(record.status ?? '') as Status;
    const visibility = String(record.visibility ?? '') as Visibility;
    const rating = Number(record.rating);
    const createdAt = String(record.createdAt ?? record.created_at ?? '');
    return {
      mediaType: MEDIA_TYPES.includes(mediaType) ? mediaType : (options.mediaType ?? 'book'),
      title: String(record.title ?? '').trim(),
      creators: String(record.creators ?? ''),
      year: record.year ? Number(record.year) : null,
      status: STATUSES.includes(status) ? status : 'liked',
      rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating) : null,
      tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag).toLowerCase()) : [],
      notes: String(record.notes ?? ''),
      identifiers:
        record.identifiers && typeof record.identifiers === 'object' ?
          (record.identifiers as Record<string, string>)
        : {},
      coverUrl: record.coverUrl ? String(record.coverUrl) : null,
      source: String(record.source ?? 'import'),
      visibility: VISIBILITIES.includes(visibility)
        ? visibility
        : (options.defaultVisibility ?? 'friends'),
      ...(createdAt ? { createdAt } : {}),
    };
  });

  return ingest(db, userId, candidates, options, 'openlibrary');
}

export function importFile(
  db: Db,
  userId: string,
  filename: string,
  content: string,
  options: ImportOptions = {},
): ImportResult {
  const isJson = filename.toLowerCase().endsWith('.json') || content.trimStart().startsWith('[') || content.trimStart().startsWith('{');
  return isJson
    ? importJson(db, userId, content, options)
    : importCsv(db, userId, content, options);
}
