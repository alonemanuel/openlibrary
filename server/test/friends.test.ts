import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, registerUser, startTestServer, type TestServer } from './helpers.js';

describe('friends and visibility', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });

  it('sends, lists and accepts a friend request', async () => {
    const alice = await registerUser(server);
    const bob = await registerUser(server);

    const request = await alice.client.post('/api/friends/requests', { handle: bob.handle });
    assert.equal(request.status, 201);

    const bobsView = await bob.client.get('/api/friends');
    assert.equal(bobsView.body.requests.incoming.length, 1);
    assert.equal(bobsView.body.requests.incoming[0].user.handle, alice.handle);

    const alicesView = await alice.client.get('/api/friends');
    assert.equal(alicesView.body.requests.outgoing.length, 1);
    assert.equal(alicesView.body.friends.length, 0);

    const friendshipId = bobsView.body.requests.incoming[0].friendshipId;
    await bob.client.post(`/api/friends/requests/${friendshipId}/accept`);

    assert.equal((await bob.client.get('/api/friends')).body.friends.length, 1);
    assert.equal((await alice.client.get('/api/friends')).body.friends.length, 1);
  });

  it('treats crossing requests as a match', async () => {
    const alice = await registerUser(server);
    const bob = await registerUser(server);

    await alice.client.post('/api/friends/requests', { handle: bob.handle });
    const crossed = await bob.client.post('/api/friends/requests', { handle: alice.handle });
    assert.equal(crossed.body.friendship.status, 'accepted');
    assert.equal((await alice.client.get('/api/friends')).body.friends.length, 1);
  });

  it('shows a friend only the items shared with friends', async () => {
    const alice = await registerUser(server);
    const bob = await registerUser(server);

    await addItem(alice.client, { title: 'Shared With Friends', visibility: 'friends' });
    await addItem(alice.client, { title: 'Out In The Open', visibility: 'public' });
    await addItem(alice.client, { title: 'Just For Me', visibility: 'private' });

    // Not friends yet, and Alice's library defaults to friends-only.
    const before = await bob.client.get(`/api/users/${alice.handle}`);
    assert.equal(before.status, 403);

    await alice.client.post('/api/friends/requests', { handle: bob.handle });
    const pending = (await bob.client.get('/api/friends')).body.requests.incoming[0];
    await bob.client.post(`/api/friends/requests/${pending.friendshipId}/accept`);

    const after = await bob.client.get(`/api/users/${alice.handle}`);
    assert.equal(after.status, 200);
    assert.equal(after.body.access, 'friends');
    const titles = after.body.items.map((item: any) => item.title).sort();
    assert.deepEqual(titles, ['Out In The Open', 'Shared With Friends']);
  });

  it('shows strangers only public items of a public library', async () => {
    const owner = await registerUser(server);
    const stranger = await registerUser(server);

    await addItem(owner.client, { title: 'Public Pick', visibility: 'public' });
    await addItem(owner.client, { title: 'Friends Only', visibility: 'friends' });

    assert.equal((await stranger.client.get(`/api/users/${owner.handle}`)).status, 403);

    await owner.client.patch('/api/auth/me', { libraryVisibility: 'public' });
    const view = await stranger.client.get(`/api/users/${owner.handle}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.access, 'public');
    assert.deepEqual(
      view.body.items.map((item: any) => item.title),
      ['Public Pick'],
    );
  });

  it('honours a private library even for friends', async () => {
    const owner = await registerUser(server);
    const friend = await registerUser(server);

    await addItem(owner.client, { title: 'Nobody Sees This', visibility: 'public' });
    await owner.client.post('/api/friends/requests', { handle: friend.handle });
    const pending = (await friend.client.get('/api/friends')).body.requests.incoming[0];
    await friend.client.post(`/api/friends/requests/${pending.friendshipId}/accept`);
    await owner.client.patch('/api/auth/me', { libraryVisibility: 'private' });

    assert.equal((await friend.client.get(`/api/users/${owner.handle}`)).status, 403);
    // The owner still sees everything.
    const own = await owner.client.get(`/api/users/${owner.handle}`);
    assert.equal(own.body.access, 'owner');
    assert.equal(own.body.items.length, 1);
  });

  it('stops sharing when a friendship is removed', async () => {
    const alice = await registerUser(server);
    const bob = await registerUser(server);
    await addItem(alice.client, { title: 'Mutual Interest', visibility: 'friends' });

    await alice.client.post('/api/friends/requests', { handle: bob.handle });
    const pending = (await bob.client.get('/api/friends')).body.requests.incoming[0];
    await bob.client.post(`/api/friends/requests/${pending.friendshipId}/accept`);
    assert.equal((await bob.client.get(`/api/users/${alice.handle}`)).status, 200);

    await bob.client.del(`/api/friends/${pending.friendshipId}`);
    assert.equal((await bob.client.get(`/api/users/${alice.handle}`)).status, 403);
  });

  it('finds people by handle and refuses unknown ones', async () => {
    const alice = await registerUser(server, { handle: 'searchable_alice' });
    const bob = await registerUser(server);

    const found = await bob.client.get('/api/friends/search?q=searchable');
    assert.equal(found.body.users.length, 1);
    assert.equal(found.body.users[0].handle, alice.handle);

    const missing = await bob.client.post('/api/friends/requests', { handle: 'nobody_here' });
    assert.equal(missing.status, 404);
  });

  it('will not let you friend yourself', async () => {
    const alice = await registerUser(server);
    const response = await alice.client.post('/api/friends/requests', { handle: alice.handle });
    assert.equal(response.status, 400);
  });
});
