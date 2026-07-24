import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsvRecords } from '../src/export/csv.js';
import { addItem, registerUser, startTestServer, type TestServer } from './helpers.js';

/**
 * A stand-in for Google Drive: records every request and answers the handful of
 * endpoints the adapter uses. Lets us prove the upload flow end to end without
 * a network or a Google account.
 */
function createFakeDrive() {
  const calls: { method: string; url: string; body?: string }[] = [];
  const files = new Map<string, { name: string; content: string; parent: string }>();
  let nextId = 1;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    calls.push({ method, url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });

    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return json({ access_token: 'test-access-token', expires_in: 3600 });
    }

    if (url.startsWith('https://www.googleapis.com/drive/v3/files') && method === 'GET') {
      const query = new URL(url).searchParams.get('q') ?? '';
      const nameMatch = query.match(/name = '([^']*)'/);
      const name = nameMatch?.[1];
      if (query.includes('application/vnd.google-apps.folder')) {
        const folder = [...files.entries()].find(
          ([, file]) => file.name === name && file.content === '<folder>',
        );
        return json({ files: folder ? [{ id: folder[0], name }] : [] });
      }
      const existing = [...files.entries()].find(([, file]) => file.name === name);
      return json({ files: existing ? [{ id: existing[0], name }] : [] });
    }

    if (url.startsWith('https://www.googleapis.com/drive/v3/files') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name: string };
      const id = `folder-${nextId++}`;
      files.set(id, { name: body.name, content: '<folder>', parent: 'root' });
      return json({ id });
    }

    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const raw = String(init?.body ?? '');
      const metadataMatch = raw.match(/\{"name":"([^"]+)"/);
      const name = metadataMatch?.[1] ?? 'unknown';
      const parts = raw.split('\r\n\r\n');
      const content = (parts[2] ?? '').split('\r\n--')[0] ?? '';
      const id = method === 'PATCH' ? url.split('/files/')[1]!.split('?')[0]! : `file-${nextId++}`;
      files.set(decodeURIComponent(id), { name, content, parent: 'folder' });
      return json({ id: decodeURIComponent(id) });
    }

    return new Response('unexpected request', { status: 500 });
  };

  return { fetchImpl, calls, files };
}

describe('sync targets', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });

  it('writes CSVs to a local folder', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Dune', creators: 'Frank Herbert', year: 1965 });
    await addItem(client, { mediaType: 'movie', title: 'Arrival', year: 2016 });

    const created = await client.post('/api/sync/targets', {
      kind: 'local',
      name: 'Drive folder',
      config: { path: 'my-library' },
    });
    assert.equal(created.status, 201);

    const run = await client.post(`/api/sync/targets/${created.body.target.id}/run`);
    assert.equal(run.status, 200);
    assert.equal(run.body.result.status, 'ok');

    const dir = path.join(server.ctx.config.syncRoot, 'my-library');
    const written = fs.readdirSync(dir).sort();
    assert.deepEqual(written, [
      'MANIFEST.json',
      'README.md',
      'books.csv',
      'library.csv',
      'library.json',
      'movies.csv',
    ]);

    const records = parseCsvRecords(fs.readFileSync(path.join(dir, 'library.csv'), 'utf8'));
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((record) => record.title).sort(), ['Arrival', 'Dune']);

    // A second run overwrites in place rather than piling up files.
    await client.post(`/api/sync/targets/${created.body.target.id}/run`);
    assert.equal(fs.readdirSync(dir).length, 6);
  });

  it('refuses to write outside the sync root', async () => {
    const { client } = await registerUser(server);
    const escape = await client.post('/api/sync/targets', {
      kind: 'local',
      name: 'Escape attempt',
      config: { path: '../../etc/openlibrary' },
    });
    assert.equal(escape.status, 400);

    const absolute = await client.post('/api/sync/targets', {
      kind: 'local',
      name: 'Absolute path',
      config: { path: '/etc/openlibrary' },
    });
    // Absolute paths are re-rooted under the sync root, not honoured as given.
    assert.equal(absolute.status, 201);
    assert.equal(absolute.body.target.config.path, 'etc/openlibrary');
  });

  it('records failures on the target instead of throwing them away', async () => {
    const { client } = await registerUser(server);
    const created = await client.post('/api/sync/targets', {
      kind: 'webdav',
      name: 'Unreachable Nextcloud',
      config: { url: 'http://127.0.0.1:9/nope' },
      secrets: { username: 'me', password: 'hunter2' },
    });
    assert.equal(created.status, 201);

    const run = await client.post(`/api/sync/targets/${created.body.target.id}/run`);
    assert.equal(run.status, 502);
    assert.equal(run.body.result.status, 'error');

    const targets = await client.get('/api/sync/targets');
    assert.equal(targets.body.targets[0].lastStatus, 'error');
    assert.ok(targets.body.targets[0].lastError);

    const runs = await client.get('/api/sync/runs');
    assert.equal(runs.body.runs[0].status, 'error');
  });

  it('never returns stored credentials over the API', async () => {
    const { client } = await registerUser(server);
    await client.post('/api/sync/targets', {
      kind: 'webdav',
      name: 'Nextcloud',
      config: { url: 'https://cloud.example.com/dav/library' },
      secrets: { username: 'me', password: 'super-secret-password' },
    });

    const serialized = JSON.stringify((await client.get('/api/sync/targets')).body);
    assert.ok(!serialized.includes('super-secret-password'));

    // ...and they are not sitting in the database in the clear either.
    const row = server.ctx.db
      .prepare("SELECT secrets FROM sync_targets WHERE name = 'Nextcloud'")
      .get() as { secrets: string | null };
    assert.ok(row.secrets, 'credentials should be stored');
    assert.ok(!row.secrets!.includes('super-secret-password'));
  });

  it('requires the credentials a target actually needs', async () => {
    const { client } = await registerUser(server);
    const response = await client.post('/api/sync/targets', {
      kind: 'gdrive',
      name: 'Drive',
      config: { folderName: 'Open Library' },
      secrets: { clientId: 'abc' },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /clientSecret/);
  });
});

describe('google drive target', () => {
  let server: TestServer;
  const drive = createFakeDrive();

  before(async () => {
    server = await startTestServer(drive.fetchImpl);
  });
  after(async () => {
    await server.close();
  });

  it('creates the folder once and uploads the export into it', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Dune', creators: 'Frank Herbert', year: 1965 });

    const created = await client.post('/api/sync/targets', {
      kind: 'gdrive',
      name: 'My Drive',
      config: { folderName: 'Open Library' },
      secrets: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
    });
    assert.equal(created.status, 201);

    const run = await client.post(`/api/sync/targets/${created.body.target.id}/run`);
    assert.equal(run.body.result.status, 'ok');
    assert.deepEqual(
      run.body.result.files.map((file: any) => file.name).sort(),
      ['MANIFEST.json', 'README.md', 'books.csv', 'library.csv', 'library.json'],
    );

    const uploaded = [...drive.files.values()].find((file) => file.name === 'library.csv');
    assert.ok(uploaded, 'library.csv should have been uploaded');
    assert.match(uploaded!.content, /Dune/);

    // A second run reuses the folder and updates the same files.
    const folderCreations = drive.calls.filter(
      (call) => call.method === 'POST' && call.url.includes('drive/v3/files?fields=id'),
    ).length;
    await client.post(`/api/sync/targets/${created.body.target.id}/run`);
    const folderCreationsAfter = drive.calls.filter(
      (call) => call.method === 'POST' && call.url.includes('drive/v3/files?fields=id'),
    ).length;
    assert.equal(folderCreations, folderCreationsAfter);
    assert.ok(drive.calls.some((call) => call.method === 'PATCH'));
  });
});
