import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../../lib/errors.js';
import type { SyncAdapter, SyncContext, WrittenFile } from '../types.js';
import type { ExportFile } from '../../export/exporter.js';

/**
 * Writes the export to a folder on the machine running the server.
 *
 * This is the workhorse for self-hosters: point OPENLIB_SYNC_ROOT at a folder
 * that Google Drive / Dropbox / Syncthing / a git repo already watches, and
 * your library lands in your own storage as CSVs with no OAuth involved.
 */
export const localAdapter: SyncAdapter = {
  kind: 'local',
  requiredSecrets: [],

  describe(config) {
    return `Folder: ${String(config.path ?? '')}`;
  },

  normalizeConfig(config) {
    const raw = String(config.path ?? '').trim();
    if (!raw) throw badRequest('A folder name is required');
    // Confine to a relative path under the sync root — no absolute paths and
    // no climbing out with "..".
    const normalized = path.posix.normalize(raw.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (normalized === '' || normalized === '.') throw badRequest('A folder name is required');
    if (normalized.split('/').some((segment) => segment === '..')) {
      throw badRequest('Folder must stay inside the sync root');
    }
    return { path: normalized };
  },

  async write(files: ExportFile[], ctx: SyncContext): Promise<WrittenFile[]> {
    const relative = String(this.normalizeConfig(ctx.config).path);
    const dir = path.resolve(ctx.syncRoot, relative);
    const root = path.resolve(ctx.syncRoot);
    if (dir !== root && !dir.startsWith(root + path.sep)) {
      throw badRequest('Folder must stay inside the sync root');
    }
    fs.mkdirSync(dir, { recursive: true });

    const written: WrittenFile[] = [];
    for (const file of files) {
      const destination = path.join(dir, file.name);
      // Write to a temp file and rename, so a crash mid-write can never leave a
      // truncated library behind.
      const temp = `${destination}.tmp`;
      fs.writeFileSync(temp, file.content, 'utf8');
      fs.renameSync(temp, destination);
      written.push({
        name: file.name,
        bytes: Buffer.byteLength(file.content, 'utf8'),
        location: destination,
      });
    }
    return written;
  },
};
