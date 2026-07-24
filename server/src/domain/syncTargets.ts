import type { Db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import type { SyncKind, SyncRun, SyncTarget } from './types.js';

interface TargetRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  config: string;
  secrets: string | null;
  enabled: number;
  created_at: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

function toTarget(row: TargetRow): SyncTarget {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as SyncKind,
    name: row.name,
    config: JSON.parse(row.config) as Record<string, unknown>,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
  };
}

export function createSyncTarget(
  db: Db,
  userId: string,
  input: {
    kind: SyncKind;
    name: string;
    config: Record<string, unknown>;
    secrets?: Record<string, string>;
  },
  key: Buffer,
): SyncTarget {
  const row: TargetRow = {
    id: newId('syn_'),
    user_id: userId,
    kind: input.kind,
    name: input.name,
    config: JSON.stringify(input.config),
    secrets:
      input.secrets && Object.keys(input.secrets).length > 0
        ? encryptJson(input.secrets, key)
        : null,
    enabled: 1,
    created_at: new Date().toISOString(),
    last_run_at: null,
    last_status: null,
    last_error: null,
  };
  db.prepare(
    `INSERT INTO sync_targets (id, user_id, kind, name, config, secrets, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.user_id, row.kind, row.name, row.config, row.secrets, row.enabled, row.created_at);
  return toTarget(row);
}

export function listSyncTargets(db: Db, userId: string): SyncTarget[] {
  const rows = db
    .prepare('SELECT * FROM sync_targets WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId) as unknown as TargetRow[];
  return rows.map(toTarget);
}

export function getSyncTarget(db: Db, userId: string, targetId: string): SyncTarget {
  const row = db.prepare('SELECT * FROM sync_targets WHERE id = ? AND user_id = ?').get(
    targetId,
    userId,
  ) as TargetRow | undefined;
  if (!row) throw notFound('Sync target not found');
  return toTarget(row);
}

/** Secrets are only ever decrypted inside the sync engine, never returned by the API. */
export function getSyncSecrets(db: Db, targetId: string, key: Buffer): Record<string, string> {
  const row = db.prepare('SELECT secrets FROM sync_targets WHERE id = ?').get(targetId) as
    | { secrets: string | null }
    | undefined;
  if (!row?.secrets) return {};
  return decryptJson<Record<string, string>>(row.secrets, key);
}

export function updateSyncTarget(
  db: Db,
  userId: string,
  targetId: string,
  patch: {
    name?: string;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
    enabled?: boolean;
  },
  key: Buffer,
): SyncTarget {
  getSyncTarget(db, userId, targetId);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.config !== undefined) {
    sets.push('config = ?');
    values.push(JSON.stringify(patch.config));
  }
  if (patch.secrets !== undefined) {
    sets.push('secrets = ?');
    values.push(Object.keys(patch.secrets).length ? encryptJson(patch.secrets, key) : null);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (sets.length > 0) {
    values.push(targetId);
    db.prepare(`UPDATE sync_targets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  return getSyncTarget(db, userId, targetId);
}

export function deleteSyncTarget(db: Db, userId: string, targetId: string): void {
  getSyncTarget(db, userId, targetId);
  db.prepare('DELETE FROM sync_targets WHERE id = ?').run(targetId);
}

export function listEnabledTargets(db: Db): SyncTarget[] {
  const rows = db.prepare('SELECT * FROM sync_targets WHERE enabled = 1').all() as unknown as TargetRow[];
  return rows.map(toTarget);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  target_id: string;
  user_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  files: string;
  error: string | null;
}

function toRun(row: RunRow): SyncRun {
  return {
    id: row.id,
    targetId: row.target_id,
    userId: row.user_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as SyncRun['status'],
    files: JSON.parse(row.files) as { name: string; bytes: number }[],
    error: row.error,
  };
}

export function startRun(db: Db, target: SyncTarget): string {
  const id = newId('run_');
  db.prepare(
    "INSERT INTO sync_runs (id, target_id, user_id, started_at, status) VALUES (?, ?, ?, ?, 'running')",
  ).run(id, target.id, target.userId, new Date().toISOString());
  return id;
}

export function finishRun(
  db: Db,
  runId: string,
  targetId: string,
  outcome:
    | { status: 'ok'; files: { name: string; bytes: number }[] }
    | { status: 'error'; error: string },
): void {
  const now = new Date().toISOString();
  if (outcome.status === 'ok') {
    db.prepare(
      "UPDATE sync_runs SET finished_at = ?, status = 'ok', files = ? WHERE id = ?",
    ).run(now, JSON.stringify(outcome.files), runId);
    db.prepare(
      "UPDATE sync_targets SET last_run_at = ?, last_status = 'ok', last_error = NULL WHERE id = ?",
    ).run(now, targetId);
  } else {
    db.prepare(
      "UPDATE sync_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?",
    ).run(now, outcome.error, runId);
    db.prepare(
      "UPDATE sync_targets SET last_run_at = ?, last_status = 'error', last_error = ? WHERE id = ?",
    ).run(now, outcome.error, targetId);
  }
}

export function listRuns(db: Db, userId: string, targetId?: string, limit = 20): SyncRun[] {
  const rows = targetId
    ? (db
        .prepare(
          'SELECT * FROM sync_runs WHERE user_id = ? AND target_id = ? ORDER BY started_at DESC LIMIT ?',
        )
        .all(userId, targetId, limit) as unknown as RunRow[])
    : (db
        .prepare('SELECT * FROM sync_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(userId, limit) as unknown as RunRow[]);
  return rows.map(toRun);
}
