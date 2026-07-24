import { badRequest } from '../../lib/errors.js';
import type { SyncAdapter, SyncContext, WrittenFile } from '../types.js';
import type { ExportFile } from '../../export/exporter.js';

/**
 * WebDAV covers Nextcloud, ownCloud, Synology, Box and anything else that
 * speaks the protocol — the escape hatch for people who don't want their
 * library sitting in a Google folder.
 */
function authHeader(ctx: SyncContext): Record<string, string> {
  const { username, password } = ctx.secrets;
  if (!username || !password) throw badRequest('WebDAV target is missing username or password');
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}

function baseUrl(config: Record<string, unknown>): string {
  const url = String(config.url ?? '').trim();
  if (!url) throw badRequest('A WebDAV URL is required');
  return url.endsWith('/') ? url : `${url}/`;
}

export const webdavAdapter: SyncAdapter = {
  kind: 'webdav',
  requiredSecrets: ['username', 'password'],

  describe(config) {
    return `WebDAV: ${String(config.url ?? '')}`;
  },

  normalizeConfig(config) {
    const raw = String(config.url ?? '').trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw badRequest('Enter a full WebDAV URL, e.g. https://cloud.example.com/remote.php/dav/files/me/library');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw badRequest('WebDAV URL must be http(s)');
    }
    // Credentials belong in the encrypted secrets blob, not in the URL.
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.toString() };
  },

  async write(files: ExportFile[], ctx: SyncContext): Promise<WrittenFile[]> {
    const config = this.normalizeConfig(ctx.config);
    const base = baseUrl(config);
    const headers = authHeader(ctx);

    // MKCOL is idempotent enough for our purposes: 405 means it already exists.
    const mkcol = await ctx.fetchImpl(base, { method: 'MKCOL', headers });
    if (!mkcol.ok && mkcol.status !== 405 && mkcol.status !== 301) {
      throw new Error(`Could not create WebDAV collection (${mkcol.status})`);
    }

    const written: WrittenFile[] = [];
    for (const file of files) {
      const url = `${base}${encodeURIComponent(file.name)}`;
      const response = await ctx.fetchImpl(url, {
        method: 'PUT',
        headers: { ...headers, 'content-type': `${file.contentType}; charset=utf-8` },
        body: file.content,
      });
      if (!response.ok) {
        throw new Error(`WebDAV upload of ${file.name} failed (${response.status})`);
      }
      written.push({
        name: file.name,
        bytes: Buffer.byteLength(file.content, 'utf8'),
        location: url,
      });
    }
    return written;
  },
};
