import { badRequest } from '../../lib/errors.js';
import type { SyncAdapter, SyncContext, WrittenFile } from '../types.js';
import type { ExportFile } from '../../export/exporter.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

interface DriveFile {
  id: string;
  name: string;
}

/**
 * Exchanges the user's long-lived refresh token for an access token. We store
 * the refresh token (encrypted) rather than holding a Google session, so the
 * user can revoke us from their Google account at any time and sync simply
 * stops — no support ticket required.
 */
async function getAccessToken(ctx: SyncContext): Promise<string> {
  const { clientId, clientSecret, refreshToken } = ctx.secrets;
  if (!clientId || !clientSecret || !refreshToken) {
    throw badRequest('Google Drive target is missing clientId, clientSecret or refreshToken');
  }
  const response = await ctx.fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Google refused the refresh token (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Google did not return an access token');
  return body.access_token;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findOrCreateFolder(
  ctx: SyncContext,
  token: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const clauses = [
    `name = '${escapeQuery(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${escapeQuery(parentId)}' in parents` : null,
  ].filter(Boolean);

  const search = new URL(DRIVE_FILES);
  search.searchParams.set('q', clauses.join(' and '));
  search.searchParams.set('fields', 'files(id,name)');
  search.searchParams.set('pageSize', '1');

  const found = await ctx.fetchImpl(search, { headers: { authorization: `Bearer ${token}` } });
  if (!found.ok) throw new Error(`Drive folder lookup failed (${found.status}): ${await found.text()}`);
  const body = (await found.json()) as { files?: DriveFile[] };
  const existing = body.files?.[0];
  if (existing) return existing.id;

  const created = await ctx.fetchImpl(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!created.ok) throw new Error(`Could not create Drive folder (${created.status}): ${await created.text()}`);
  return ((await created.json()) as DriveFile).id;
}

async function findFileInFolder(
  ctx: SyncContext,
  token: string,
  folderId: string,
  name: string,
): Promise<string | null> {
  const search = new URL(DRIVE_FILES);
  search.searchParams.set(
    'q',
    `name = '${escapeQuery(name)}' and '${escapeQuery(folderId)}' in parents and trashed = false`,
  );
  search.searchParams.set('fields', 'files(id,name)');
  search.searchParams.set('pageSize', '1');
  const response = await ctx.fetchImpl(search, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Drive lookup failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { files?: DriveFile[] };
  return body.files?.[0]?.id ?? null;
}

/** Multipart upload: metadata part + content part, per the Drive v3 API. */
async function uploadFile(
  ctx: SyncContext,
  token: string,
  folderId: string,
  file: ExportFile,
  existingId: string | null,
): Promise<string> {
  const boundary = `openlibrary-${Math.random().toString(36).slice(2)}`;
  const metadata: Record<string, unknown> = { name: file.name };
  if (!existingId) metadata.parents = [folderId];

  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${file.contentType}; charset=UTF-8\r\n\r\n` +
    `${file.content}\r\n` +
    `--${boundary}--\r\n`;

  const url = existingId
    ? `${DRIVE_UPLOAD}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id`
    : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`;

  const response = await ctx.fetchImpl(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Drive upload of ${file.name} failed (${response.status}): ${await response.text()}`);
  }
  return ((await response.json()) as DriveFile).id;
}

export const gdriveAdapter: SyncAdapter = {
  kind: 'gdrive',
  requiredSecrets: ['clientId', 'clientSecret', 'refreshToken'],

  describe(config) {
    return `Google Drive folder: ${String(config.folderName ?? 'Open Library')}`;
  },

  normalizeConfig(config) {
    const folderName = String(config.folderName ?? 'Open Library').trim() || 'Open Library';
    if (folderName.includes('/')) throw badRequest('Folder name cannot contain "/"');
    const parentFolderId = String(config.parentFolderId ?? '').trim();
    return { folderName, ...(parentFolderId ? { parentFolderId } : {}) };
  },

  async write(files: ExportFile[], ctx: SyncContext): Promise<WrittenFile[]> {
    const config = this.normalizeConfig(ctx.config);
    const token = await getAccessToken(ctx);
    const folderId = await findOrCreateFolder(
      ctx,
      token,
      String(config.folderName),
      (config.parentFolderId as string | undefined) ?? null,
    );

    const written: WrittenFile[] = [];
    for (const file of files) {
      const existingId = await findFileInFolder(ctx, token, folderId, file.name);
      const id = await uploadFile(ctx, token, folderId, file, existingId);
      written.push({
        name: file.name,
        bytes: Buffer.byteLength(file.content, 'utf8'),
        location: `https://drive.google.com/file/d/${id}`,
      });
    }
    return written;
  },
};
