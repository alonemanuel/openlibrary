import type { Db } from '../db/index.js';
import { listItems } from '../domain/items.js';
import { listFriends } from '../domain/friends.js';
import { getUserById } from '../domain/users.js';
import { MEDIA_TYPES, type Item, type MediaType } from '../domain/types.js';
import { sha256 } from '../lib/crypto.js';
import { toCsv } from './csv.js';

export const EXPORT_FORMAT_VERSION = 1;

/**
 * The canonical CSV column order. This is a published contract: anything that
 * reads an Open Library export — our own importer, a spreadsheet, a script
 * somebody writes in five years — can rely on these names.
 */
export const ITEM_COLUMNS = [
  'id',
  'media_type',
  'title',
  'creators',
  'year',
  'status',
  'rating',
  'tags',
  'notes',
  'identifiers',
  'cover_url',
  'source',
  'visibility',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export interface ExportFile {
  name: string;
  content: string;
  contentType: string;
}

export interface ExportBundle {
  files: ExportFile[];
  itemCount: number;
  generatedAt: string;
}

export function itemToRow(item: Item): (string | number | null)[] {
  return [
    item.id,
    item.mediaType,
    item.title,
    item.creators,
    item.year,
    item.status,
    item.rating,
    item.tags.join('; '),
    item.notes,
    Object.keys(item.identifiers).length ? JSON.stringify(item.identifiers) : '',
    item.coverUrl,
    item.source,
    item.visibility,
    item.createdAt,
    item.updatedAt,
    item.deletedAt,
  ];
}

export function itemsToCsv(items: Item[]): string {
  return toCsv([ITEM_COLUMNS as readonly string[], ...items.map(itemToRow)]);
}

const PLURAL: Record<MediaType, string> = {
  book: 'books',
  movie: 'movies',
  tv: 'tv',
  music: 'music',
  podcast: 'podcasts',
  game: 'games',
};

const README = `# Your Open Library export

This folder is yours. It is written in plain CSV and JSON so that it stays
readable with or without the software that produced it.

## Files

- \`library.csv\`      every item in one table
- \`<type>.csv\`       one file per media type (books, movies, tv, music, ...)
- \`library.json\`     the same data with full fidelity, plus your profile
- \`MANIFEST.json\`    checksums, counts and the export format version

## Columns

${ITEM_COLUMNS.map((c) => `- \`${c}\``).join('\n')}

\`tags\` is a \`; \`-separated list. \`identifiers\` is a JSON object of external
ids (isbn, openlibrary, imdb, musicbrainz, ...). \`deleted_at\` is set for items
you removed — they are kept, never dropped, so nothing disappears without a
trace.

Values that begin with \`=\`, \`+\`, \`-\` or \`@\` are prefixed with an apostrophe
so spreadsheet apps don't treat them as formulas. The importer strips it back.

## Getting the data back in

Upload \`library.csv\` (or \`library.json\`) on the Sync & Backup page, or POST it
to \`/api/import\`. Items are matched on their external identifiers and then on
title + year, so re-importing updates rather than duplicates.
`;

const PAGE_SIZE = 1000;

/** Pages through the whole library — exports must never silently truncate. */
function allItems(db: Db, userId: string, includeDeleted: boolean): Item[] {
  const items: Item[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = listItems(db, userId, {
      includeDeleted,
      limit: PAGE_SIZE,
      offset,
      sort: 'added_asc',
    });
    items.push(...page);
    if (page.length < PAGE_SIZE) return items;
  }
}

export interface ExportOptions {
  /** Include soft-deleted items (default true — they're part of your history). */
  includeDeleted?: boolean;
  mediaTypes?: MediaType[];
}

export function buildExport(db: Db, userId: string, options: ExportOptions = {}): ExportBundle {
  const includeDeleted = options.includeDeleted ?? true;
  const user = getUserById(db, userId);
  const items = allItems(db, userId, includeDeleted);

  const selected = options.mediaTypes?.length
    ? items.filter((item) => options.mediaTypes!.includes(item.mediaType))
    : items;

  const generatedAt = new Date().toISOString();
  const files: ExportFile[] = [
    { name: 'library.csv', content: itemsToCsv(selected), contentType: 'text/csv' },
  ];

  for (const mediaType of MEDIA_TYPES) {
    const subset = selected.filter((item) => item.mediaType === mediaType);
    if (subset.length === 0) continue;
    files.push({
      name: `${PLURAL[mediaType]}.csv`,
      content: itemsToCsv(subset),
      contentType: 'text/csv',
    });
  }

  const json = {
    format: 'openlibrary-export',
    version: EXPORT_FORMAT_VERSION,
    generatedAt,
    profile: user
      ? {
          handle: user.handle,
          displayName: user.displayName,
          libraryVisibility: user.libraryVisibility,
          friends: listFriends(db, userId).map((friend) => friend.user.handle),
        }
      : null,
    items: selected,
  };
  files.push({
    name: 'library.json',
    content: JSON.stringify(json, null, 2) + '\n',
    contentType: 'application/json',
  });
  files.push({ name: 'README.md', content: README, contentType: 'text/markdown' });

  const manifest = {
    format: 'openlibrary-manifest',
    version: EXPORT_FORMAT_VERSION,
    generatedAt,
    itemCount: selected.length,
    files: files.map((file) => ({
      name: file.name,
      bytes: Buffer.byteLength(file.content, 'utf8'),
      sha256: sha256(file.content),
    })),
  };
  files.push({
    name: 'MANIFEST.json',
    content: JSON.stringify(manifest, null, 2) + '\n',
    contentType: 'application/json',
  });

  return { files, itemCount: selected.length, generatedAt };
}
