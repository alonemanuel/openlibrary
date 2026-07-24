import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, registerUser, startTestServer, type TestServer } from './helpers.js';

describe('accounts and the library', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });

  it('registers, signs out and signs back in', async () => {
    const { client, email } = await registerUser(server);

    const me = await client.get('/api/auth/me');
    assert.equal(me.body.user.email, email);

    await client.post('/api/auth/logout');
    const loggedOut = await client.get('/api/auth/me');
    assert.equal(loggedOut.body.user, null);

    const denied = await client.get('/api/items');
    assert.equal(denied.status, 401);

    const login = await client.post('/api/auth/login', {
      email,
      password: 'correct horse battery',
    });
    assert.equal(login.status, 200);
    assert.equal((await client.get('/api/items')).status, 200);
  });

  it('rejects a wrong password without leaking which field was wrong', async () => {
    const { email } = await registerUser(server);
    const { client } = await registerUser(server);
    const response = await client.post('/api/auth/login', { email, password: 'not the password' });
    assert.equal(response.status, 401);
    assert.match(response.body.error.message, /Email or password/);
  });

  it('refuses a duplicate handle', async () => {
    const { handle } = await registerUser(server);
    const { client } = await registerUser(server);
    const response = await client.post('/api/auth/register', {
      email: 'someone-else@example.com',
      handle,
      password: 'correct horse battery',
    });
    assert.equal(response.status, 409);
  });

  it('creates, filters and updates items', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Solaris', creators: 'Stanisław Lem', year: 1961, tags: ['sci-fi'] });
    await addItem(client, {
      mediaType: 'movie',
      title: 'Stalker',
      creators: 'Andrei Tarkovsky',
      year: 1979,
      tags: ['slow'],
    });
    await addItem(client, {
      mediaType: 'music',
      title: 'Blue',
      creators: 'Joni Mitchell',
      year: 1971,
      tags: ['folk'],
    });

    const all = await client.get('/api/items');
    assert.equal(all.body.items.length, 3);

    const movies = await client.get('/api/items?type=movie');
    assert.equal(movies.body.items.length, 1);
    assert.equal(movies.body.items[0].title, 'Stalker');

    const tagged = await client.get('/api/items?tag=sci-fi');
    assert.equal(tagged.body.items.length, 1);

    const searched = await client.get('/api/items?q=joni');
    assert.equal(searched.body.items.length, 1);
    assert.equal(searched.body.items[0].title, 'Blue');

    const target = all.body.items.find((item: any) => item.title === 'Solaris');
    const updated = await client.patch(`/api/items/${target.id}`, { rating: 10, status: 'done' });
    assert.equal(updated.body.item.rating, 10);
    assert.equal(updated.body.item.status, 'done');
  });

  it('treats a re-add as the same item rather than a duplicate', async () => {
    const { client } = await registerUser(server);
    const first = await addItem(client, {
      title: 'Piranesi',
      identifiers: { isbn: '9781526622426' },
    });
    const second = await client.post('/api/items', {
      mediaType: 'book',
      title: 'Piranesi (paperback)',
      identifiers: { isbn: '9781526622426' },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.item.id, first.id);
  });

  it('keeps deleted items and can restore them', async () => {
    const { client } = await registerUser(server);
    const item = await addItem(client, { title: 'A Wizard of Earthsea' });

    await client.del(`/api/items/${item.id}`);
    assert.equal((await client.get('/api/items')).body.items.length, 0);

    const deleted = await client.get('/api/items?deleted=1');
    assert.equal(deleted.body.items.length, 1);
    assert.ok(deleted.body.items[0].deletedAt);

    const restored = await client.post(`/api/items/${item.id}/restore`);
    assert.equal(restored.body.item.deletedAt, null);
    assert.equal((await client.get('/api/items')).body.items.length, 1);

    // Every step is on the record.
    const history = await client.get(`/api/items/${item.id}/history`);
    assert.deepEqual(
      history.body.events.map((event: any) => event.kind),
      ['created', 'deleted', 'restored'],
    );
  });

  it('will not let one account touch another account\'s items', async () => {
    const owner = await registerUser(server);
    const stranger = await registerUser(server);
    const item = await addItem(owner.client, { title: 'Private Reading' });

    assert.equal((await stranger.client.get(`/api/items/${item.id}`)).status, 404);
    assert.equal((await stranger.client.patch(`/api/items/${item.id}`, { rating: 1 })).status, 404);
    assert.equal((await stranger.client.del(`/api/items/${item.id}`)).status, 404);
  });

  it('validates input instead of storing nonsense', async () => {
    const { client } = await registerUser(server);
    assert.equal((await client.post('/api/items', { mediaType: 'book' })).status, 400);
    assert.equal((await client.post('/api/items', { mediaType: 'sculpture', title: 'x' })).status, 400);
    assert.equal(
      (await client.post('/api/items', { mediaType: 'book', title: 'x', rating: 99 })).status,
      400,
    );
  });

  it('reports library stats', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'One', tags: ['favourites'] });
    await addItem(client, { mediaType: 'movie', title: 'Two', tags: ['favourites'] });
    const removed = await addItem(client, { title: 'Three' });
    await client.del(`/api/items/${removed.id}`);

    const { body } = await client.get('/api/stats');
    assert.equal(body.stats.total, 2);
    assert.equal(body.stats.deleted, 1);
    assert.equal(body.stats.byMediaType.book, 1);
    assert.equal(body.stats.byMediaType.movie, 1);
    assert.deepEqual(body.stats.topTags[0], { tag: 'favourites', count: 2 });
  });

  it('applies bulk actions', async () => {
    const { client } = await registerUser(server);
    const a = await addItem(client, { title: 'Bulk A' });
    const b = await addItem(client, { title: 'Bulk B' });

    const response = await client.post('/api/items/bulk', {
      ids: [a.id, b.id],
      action: 'set_visibility',
      visibility: 'public',
    });
    assert.equal(response.body.changed, 2);
    const items = await client.get('/api/items');
    assert.ok(items.body.items.every((item: any) => item.visibility === 'public'));
  });
});
