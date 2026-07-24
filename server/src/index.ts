import { createApp } from './app.js';
import { purgeExpiredSessions } from './domain/users.js';
import { createSnapshot, usersWithItems } from './domain/snapshots.js';
import { runAllSyncs } from './sync/engine.js';

const { app, ctx } = createApp();

const server = app.listen(ctx.config.port, () => {
  console.log(`[openlibrary] listening on http://localhost:${ctx.config.port}`);
  console.log(`[openlibrary] data directory: ${ctx.config.dataDir}`);
  console.log(`[openlibrary] sync root:      ${ctx.config.syncRoot}`);
  if (!ctx.config.webDist) console.log('[openlibrary] web client not built — API only');
});

const HOUR = 1000 * 60 * 60;
const SNAPSHOT_INTERVAL_MS = Number(process.env.OPENLIB_SNAPSHOT_INTERVAL_HOURS ?? 24) * HOUR;
const SYNC_INTERVAL_MS = Number(process.env.OPENLIB_SYNC_INTERVAL_HOURS ?? 6) * HOUR;

/**
 * Background upkeep. Deliberately boring: a snapshot per user per day (skipped
 * when nothing changed) and a push to every enabled sync target. Both also run
 * on demand from the UI — the schedule is a safety net, not the only path.
 */
async function takeSnapshots(): Promise<void> {
  for (const userId of usersWithItems(ctx.db)) {
    try {
      createSnapshot(ctx.db, ctx.config.snapshotDir, userId, 'scheduled');
    } catch (err) {
      console.error(`[openlibrary] snapshot failed for ${userId}:`, (err as Error).message);
    }
  }
}

async function pushSyncs(): Promise<void> {
  try {
    const { ok, failed } = await runAllSyncs(ctx.db, ctx.config, ctx.fetchImpl);
    if (ok || failed) console.log(`[openlibrary] scheduled sync: ${ok} ok, ${failed} failed`);
  } catch (err) {
    console.error('[openlibrary] scheduled sync failed:', (err as Error).message);
  }
}

const timers = [
  setInterval(() => void takeSnapshots(), SNAPSHOT_INTERVAL_MS),
  setInterval(() => void pushSyncs(), SYNC_INTERVAL_MS),
  setInterval(() => purgeExpiredSessions(ctx.db), HOUR),
];
for (const timer of timers) timer.unref();

function shutdown(signal: string): void {
  console.log(`[openlibrary] ${signal} received, shutting down`);
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
