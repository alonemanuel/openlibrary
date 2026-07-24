import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * All runtime configuration lives here. Everything has a sane default so that
 * `npm start` works on a fresh checkout with zero setup — self-hosting should
 * never require a config spelunking session.
 */
export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  /** Where `local` sync targets are allowed to write. Mount your Drive/Dropbox folder here. */
  syncRoot: string;
  /** Server-side backup snapshots (the "our cloud" copy). */
  snapshotDir: string;
  /** 32-byte key used to encrypt sync-target credentials at rest. */
  secretKey: Buffer;
  sessionTtlMs: number;
  /** Static assets built by the web workspace; served when present. */
  webDist: string | null;
  /** Disable outbound catalog lookups (offline / test mode). */
  offline: boolean;
}

function resolveDataDir(): string {
  const fromEnv = process.env.OPENLIB_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'data');
}

/**
 * The encryption key is read from OPENLIB_SECRET_KEY (hex or passphrase). If it
 * is absent we generate one and persist it next to the database, so an
 * unconfigured install is still encrypted-at-rest rather than plaintext.
 */
function resolveSecretKey(dataDir: string): Buffer {
  const fromEnv = process.env.OPENLIB_SECRET_KEY;
  if (fromEnv) {
    if (/^[0-9a-f]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');
    return crypto.scryptSync(fromEnv, 'openlibrary.secret', 32);
  }
  const keyFile = path.join(dataDir, 'secret.key');
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  return key;
}

function firstExistingDir(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const syncRoot = overrides.syncRoot ?? path.resolve(process.env.OPENLIB_SYNC_ROOT ?? path.join(dataDir, 'sync'));
  const snapshotDir = overrides.snapshotDir ?? path.join(dataDir, 'snapshots');
  fs.mkdirSync(syncRoot, { recursive: true });
  fs.mkdirSync(snapshotDir, { recursive: true });

  return {
    port: overrides.port ?? Number(process.env.PORT ?? 8787),
    dataDir,
    dbPath: overrides.dbPath ?? path.join(dataDir, 'openlibrary.db'),
    syncRoot,
    snapshotDir,
    secretKey: overrides.secretKey ?? resolveSecretKey(dataDir),
    sessionTtlMs: overrides.sessionTtlMs ?? 1000 * 60 * 60 * 24 * 30,
    webDist:
      overrides.webDist !== undefined
        ? overrides.webDist
        : firstExistingDir([
            path.resolve(process.cwd(), 'web/dist'),
            path.resolve(process.cwd(), '../web/dist'),
          ]),
    offline: overrides.offline ?? process.env.OPENLIB_OFFLINE === '1',
  };
}
