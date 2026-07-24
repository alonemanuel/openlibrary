import type { Db } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type EventKind =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored'
  | 'imported'
  | 'synced'
  | 'snapshot_restored';

export interface ItemEvent {
  id: string;
  itemId: string;
  userId: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * The event log is append-only and is never pruned. It is what lets a user
 * answer "what happened to my library?" — the question that services which
 * silently remove your content can't answer.
 */
export function recordEvent(
  db: Db,
  input: { itemId: string; userId: string; kind: EventKind; payload?: Record<string, unknown> },
): void {
  db.prepare(
    'INSERT INTO item_events (id, item_id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    newId('evt_'),
    input.itemId,
    input.userId,
    input.kind,
    JSON.stringify(input.payload ?? {}),
    new Date().toISOString(),
  );
}

interface EventRow {
  id: string;
  item_id: string;
  user_id: string;
  kind: string;
  payload: string;
  created_at: string;
}

function toEvent(row: EventRow): ItemEvent {
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    kind: row.kind as EventKind,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export function listUserEvents(db: Db, userId: string, limit = 100): ItemEvent[] {
  const rows = db
    .prepare('SELECT * FROM item_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(userId, limit) as unknown as EventRow[];
  return rows.map(toEvent);
}

export function listItemEvents(db: Db, itemId: string): ItemEvent[] {
  const rows = db
    .prepare('SELECT * FROM item_events WHERE item_id = ? ORDER BY created_at ASC, id ASC')
    .all(itemId) as unknown as EventRow[];
  return rows.map(toEvent);
}
