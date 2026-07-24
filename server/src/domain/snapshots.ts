import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { sha256 } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { buildExport } from '../export/exporter.js';
import { importJson } from '../export/importer.js';
import type { Snapshot } from './types.js';

interface SnapshotRow {
  id: string;
  user_id: string;
  created_at: string;
  item_count: number;
  byte_size: number;
  checksum: string;
  reason: string;
  filename: string;
}

function toSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    itemCount: row.item_count,
    byteSize: row.byte_size,
    checksum: row.checksum,
    reason: row.reason,
    filename: row.filename,
  };
}

function userDir(snapshotDir: string, userId: string): string {
  const dir = path.join(snapshotDir, userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A snapshot is a full, self-contained copy of the library written to disk as
 * JSON. This is the "backed up to our cloud" half of the promise — the half the
 * user doesn't have to configure. Snapshots are content-addressed by checksum,
 * so taking one when nothing changed is a no-op rather than a pile of dupes.
 */
export function createSnapshot(
  db: Db,
  snapshotDir: string,
  userId: string,
  reason = 'manual',
): { snapshot: Snapshot; unchanged: boolean } {
  const bundle = buildExport(db, userId);
  const json = bundle.files.find((file) => file.name === 'library.json');
  if (!json) throw new Error('export bundle is missing library.json');

  // Hash the library itself, not the export's `generatedAt` stamp — otherwise
  // every snapshot looks new and the daily job piles up identical copies.
  const { generatedAt: _stamp, ...stable } = JSON.parse(json.content) as Record<string, unknown>;
  const checksum = sha256(JSON.stringify(stable));

  const latest = latestSnapshot(db, userId);
  if (latest && latest.checksum === checksum) return { snapshot: latest, unchanged: true };

  const id = newId('snp_');
  const filename = `${id}.json`;
  fs.writeFileSync(path.join(userDir(snapshotDir, userId), filename), json.content, 'utf8');

  const row: SnapshotRow = {
    id,
    user_id: userId,
    created_at: new Date().toISOString(),
    item_count: bundle.itemCount,
    byte_size: Buffer.byteLength(json.content, 'utf8'),
    checksum,
    reason,
    filename,
  };
  db.prepare(
    `INSERT INTO snapshots (id, user_id, created_at, item_count, byte_size, checksum, reason, filename)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.user_id,
    row.created_at,
    row.item_count,
    row.byte_size,
    row.checksum,
    row.reason,
    row.filename,
  );
  return { snapshot: toSnapshot(row), unchanged: false };
}

export function listSnapshots(db: Db, userId: string, limit = 50): Snapshot[] {
  const rows = db
    .prepare('SELECT * FROM snapshots WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(userId, limit) as unknown as SnapshotRow[];
  return rows.map(toSnapshot);
}

export function latestSnapshot(db: Db, userId: string): Snapshot | null {
  const [first] = listSnapshots(db, userId, 1);
  return first ?? null;
}

export function getSnapshot(db: Db, userId: string, snapshotId: string): Snapshot {
  const row = db.prepare('SELECT * FROM snapshots WHERE id = ? AND user_id = ?').get(
    snapshotId,
    userId,
  ) as SnapshotRow | undefined;
  if (!row) throw notFound('Snapshot not found');
  return toSnapshot(row);
}

export function readSnapshot(db: Db, snapshotDir: string, userId: string, snapshotId: string): string {
  const snapshot = getSnapshot(db, userId, snapshotId);
  const file = path.join(snapshotDir, userId, snapshot.filename);
  if (!fs.existsSync(file)) throw notFound('Snapshot data is missing from storage');
  return fs.readFileSync(file, 'utf8');
}

/**
 * Restores a snapshot on top of the current library. This is additive by
 * design: it re-creates anything missing and updates what it finds, but never
 * deletes items added since the snapshot was taken. A restore should not be
 * able to lose data either.
 */
export function restoreSnapshot(
  db: Db,
  snapshotDir: string,
  userId: string,
  snapshotId: string,
): { created: number; updated: number; skipped: number } {
  const content = readSnapshot(db, snapshotDir, userId, snapshotId);
  // Take a safety snapshot first, so a restore is itself undoable.
  createSnapshot(db, snapshotDir, userId, 'pre_restore');
  const result = importJson(db, userId, content, { updateExisting: true });
  return { created: result.created, updated: result.updated, skipped: result.skipped };
}

/** Users with at least one item — the set worth snapshotting on a schedule. */
export function usersWithItems(db: Db): string[] {
  const rows = db
    .prepare('SELECT DISTINCT user_id FROM items WHERE deleted_at IS NULL')
    .all() as { user_id: string }[];
  return rows.map((row) => row.user_id);
}
