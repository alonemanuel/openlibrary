import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, registerUser, startTestServer, type TestServer } from './helpers.js';

describe('cloud backup snapshots', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });

  it('takes a snapshot and skips a second one when nothing changed', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Dune' });

    const first = await client.post('/api/snapshots');
    assert.equal(first.status, 201);
    assert.equal(first.body.snapshot.itemCount, 1);
    assert.equal(first.body.unchanged, false);

    const second = await client.post('/api/snapshots');
    assert.equal(second.status, 200);
    assert.equal(second.body.unchanged, true);
    assert.equal(second.body.snapshot.id, first.body.snapshot.id);
    assert.equal((await client.get('/api/snapshots')).body.snapshots.length, 1);

    await addItem(client, { title: 'Arrival', mediaType: 'movie' });
    const third = await client.post('/api/snapshots');
    assert.equal(third.status, 201);
    assert.equal(third.body.snapshot.itemCount, 2);
  });

  it('restores a snapshot after items are lost, without touching newer ones', async () => {
    const { client } = await registerUser(server);
    const doomed = await addItem(client, { title: 'Important Book', rating: 9 });
    await addItem(client, { title: 'Another Book' });
    const snapshot = (await client.post('/api/snapshots')).body.snapshot;

    // The disaster this whole project exists to survive.
    await client.del(`/api/items/${doomed.id}`);
    const added = await addItem(client, { title: 'Added After The Snapshot' });
    assert.equal((await client.get('/api/items')).body.items.length, 2);

    const restore = await client.post(`/api/snapshots/${snapshot.id}/restore`);
    assert.equal(restore.status, 200);

    const titles = (await client.get('/api/items')).body.items.map((item: any) => item.title).sort();
    assert.deepEqual(titles, ['Added After The Snapshot', 'Another Book', 'Important Book']);

    // The item added after the snapshot survives the restore untouched.
    assert.equal((await client.get(`/api/items/${added.id}`)).status, 200);

    // And a restore is itself undoable: a safety snapshot is taken first.
    const reasons = (await client.get('/api/snapshots')).body.snapshots.map((s: any) => s.reason);
    assert.ok(reasons.includes('pre_restore'));
  });

  it('downloads a snapshot as plain JSON', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Downloadable' });
    const snapshot = (await client.post('/api/snapshots')).body.snapshot;

    const download = await client.get(`/api/snapshots/${snapshot.id}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.body.format, 'openlibrary-export');
    assert.equal(download.body.items[0].title, 'Downloadable');
  });

  it('keeps snapshots private to their owner', async () => {
    const owner = await registerUser(server);
    const stranger = await registerUser(server);
    await addItem(owner.client, { title: 'Not Yours' });
    const snapshot = (await owner.client.post('/api/snapshots')).body.snapshot;

    assert.equal((await stranger.client.get(`/api/snapshots/${snapshot.id}/download`)).status, 404);
    assert.equal((await stranger.client.post(`/api/snapshots/${snapshot.id}/restore`)).status, 404);
    assert.equal((await stranger.client.get('/api/snapshots')).body.snapshots.length, 0);
  });
});
