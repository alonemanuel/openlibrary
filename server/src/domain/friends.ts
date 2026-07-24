import type { Db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toPublicUser, getUserById } from './users.js';
import type { Friendship, FriendshipStatus, PublicUser } from './types.js';

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function toFriendship(row: FriendshipRow): Friendship {
  return {
    id: row.id,
    requesterId: row.requester_id,
    addresseeId: row.addressee_id,
    status: row.status as FriendshipStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findEdge(db: Db, a: string, b: string): Friendship | null {
  const row = db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    )
    .get(a, b, b, a) as FriendshipRow | undefined;
  return row ? toFriendship(row) : null;
}

export function requestFriendship(db: Db, requesterId: string, addresseeId: string): Friendship {
  if (requesterId === addresseeId) throw badRequest('You are already yourself');
  if (!getUserById(db, addresseeId)) throw notFound('No such person');

  const existing = findEdge(db, requesterId, addresseeId);
  if (existing) {
    if (existing.status === 'accepted') throw conflict('You are already friends');
    if (existing.status === 'blocked') throw conflict('This request cannot be sent');
    // A pending request in the other direction means both sides want it.
    if (existing.requesterId === addresseeId) return acceptFriendship(db, requesterId, existing.id);
    return existing;
  }

  const now = new Date().toISOString();
  const row: FriendshipRow = {
    id: newId('frn_'),
    requester_id: requesterId,
    addressee_id: addresseeId,
    status: 'pending',
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    'INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.requester_id, row.addressee_id, row.status, row.created_at, row.updated_at);
  return toFriendship(row);
}

function getFriendship(db: Db, id: string): Friendship {
  const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id) as
    | FriendshipRow
    | undefined;
  if (!row) throw notFound('Friend request not found');
  return toFriendship(row);
}

export function acceptFriendship(db: Db, userId: string, friendshipId: string): Friendship {
  const friendship = getFriendship(db, friendshipId);
  if (friendship.addresseeId !== userId) throw notFound('Friend request not found');
  if (friendship.status === 'accepted') return friendship;
  const now = new Date().toISOString();
  db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(
    now,
    friendshipId,
  );
  return { ...friendship, status: 'accepted', updatedAt: now };
}

/** Declines a pending request or removes an existing friendship. */
export function removeFriendship(db: Db, userId: string, friendshipId: string): void {
  const friendship = getFriendship(db, friendshipId);
  if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
    throw notFound('Friend request not found');
  }
  db.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
}

export function areFriends(db: Db, a: string, b: string): boolean {
  const edge = findEdge(db, a, b);
  return edge?.status === 'accepted';
}

export interface FriendEntry {
  friendshipId: string;
  user: PublicUser;
  since: string;
}

export function listFriends(db: Db, userId: string): FriendEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM friendships
       WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
       ORDER BY updated_at DESC`,
    )
    .all(userId, userId) as unknown as FriendshipRow[];

  const entries: FriendEntry[] = [];
  for (const row of rows) {
    const otherId = row.requester_id === userId ? row.addressee_id : row.requester_id;
    const user = getUserById(db, otherId);
    if (!user) continue;
    entries.push({ friendshipId: row.id, user: toPublicUser(user), since: row.updated_at });
  }
  return entries;
}

export interface PendingRequests {
  incoming: { friendshipId: string; user: PublicUser; requestedAt: string }[];
  outgoing: { friendshipId: string; user: PublicUser; requestedAt: string }[];
}

export function listPendingRequests(db: Db, userId: string): PendingRequests {
  const rows = db
    .prepare(
      `SELECT * FROM friendships
       WHERE status = 'pending' AND (requester_id = ? OR addressee_id = ?)
       ORDER BY created_at DESC`,
    )
    .all(userId, userId) as unknown as FriendshipRow[];

  const result: PendingRequests = { incoming: [], outgoing: [] };
  for (const row of rows) {
    const incoming = row.addressee_id === userId;
    const otherId = incoming ? row.requester_id : row.addressee_id;
    const user = getUserById(db, otherId);
    if (!user) continue;
    const entry = { friendshipId: row.id, user: toPublicUser(user), requestedAt: row.created_at };
    if (incoming) result.incoming.push(entry);
    else result.outgoing.push(entry);
  }
  return result;
}

/**
 * How much of `owner`'s library `viewer` may see. Two gates apply, and both
 * must pass: the owner's library-level setting, then each item's own
 * visibility field.
 *
 *   library `private` — nobody but the owner, friends included
 *   library `friends` — friends see `friends` + `public` items, strangers none
 *   library `public`  — strangers see `public` items, friends also see `friends`
 *
 * Returns null when the viewer may see nothing at all.
 */
export function visibilityFor(
  db: Db,
  viewerId: string | null,
  ownerId: string,
): 'owner' | 'friends' | 'public' | null {
  if (viewerId && viewerId === ownerId) return 'owner';
  const owner = getUserById(db, ownerId);
  if (!owner) return null;
  if (owner.libraryVisibility === 'private') return null;
  if (viewerId && areFriends(db, viewerId, ownerId)) return 'friends';
  return owner.libraryVisibility === 'public' ? 'public' : null;
}
