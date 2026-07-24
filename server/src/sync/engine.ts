import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import { buildExport } from '../export/exporter.js';
import {
  finishRun,
  getSyncSecrets,
  listEnabledTargets,
  startRun,
} from '../domain/syncTargets.js';
import type { SyncTarget } from '../domain/types.js';
import { badRequest } from '../lib/errors.js';
import { localAdapter } from './targets/local.js';
import { gdriveAdapter } from './targets/gdrive.js';
import { webdavAdapter } from './targets/webdav.js';
import type { SyncAdapter, WrittenFile } from './types.js';

export const ADAPTERS: Record<string, SyncAdapter> = {
  local: localAdapter,
  gdrive: gdriveAdapter,
  webdav: webdavAdapter,
};

export function getAdapter(kind: string): SyncAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw badRequest(`Unknown sync target type "${kind}"`);
  return adapter;
}

export interface RunSyncResult {
  runId: string;
  status: 'ok' | 'error';
  files: WrittenFile[];
  error?: string;
}

/**
 * Exports the user's library and hands it to the target's adapter. Failures are
 * recorded rather than thrown: one broken destination must never block the
 * others, and the user needs the error visible in the UI, not in a log file.
 */
export async function runSync(
  db: Db,
  config: Config,
  target: SyncTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSyncResult> {
  const runId = startRun(db, target);
  try {
    const bundle = buildExport(db, target.userId);
    const adapter = getAdapter(target.kind);
    const files = await adapter.write(bundle.files, {
      syncRoot: config.syncRoot,
      config: target.config,
      secrets: getSyncSecrets(db, target.id, config.secretKey),
      fetchImpl,
    });
    finishRun(db, runId, target.id, {
      status: 'ok',
      files: files.map((file) => ({ name: file.name, bytes: file.bytes })),
    });
    return { runId, status: 'ok', files };
  } catch (err) {
    const message = (err as Error).message || 'Sync failed';
    finishRun(db, runId, target.id, { status: 'error', error: message });
    return { runId, status: 'error', files: [], error: message };
  }
}

/** Runs every enabled target for every user. Used by the scheduler. */
export async function runAllSyncs(
  db: Db,
  config: Config,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const target of listEnabledTargets(db)) {
    const result = await runSync(db, config, target, fetchImpl);
    if (result.status === 'ok') ok += 1;
    else failed += 1;
  }
  return { ok, failed };
}
