import type { Db } from '../db/index.js';
import { newId, newToken } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { conflict, unauthorized } from '../lib/errors.js';
import type { PublicUser, User, Visibility } from './types.js';

interface UserRow {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  password_hash: string;
  created_at: string;
  library_visibility: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    createdAt: row.created_at,
    libraryVisibility: row.library_visibility as Visibility,
  };
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    libraryVisibility: user.libraryVisibility,
  };
}

export function createUser(
  db: Db,
  input: { email: string; handle: string; displayName: string; password: string },
): User {
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email);
  if (existingEmail) throw conflict('An account with that email already exists');
  const existingHandle = db.prepare('SELECT id FROM users WHERE handle = ?').get(input.handle);
  if (existingHandle) throw conflict('That handle is taken');

  const row: UserRow = {
    id: newId('usr_'),
    email: input.email,
    handle: input.handle,
    display_name: input.displayName,
    password_hash: hashPassword(input.password),
    created_at: new Date().toISOString(),
    library_visibility: 'friends',
  };
  db.prepare(
    `INSERT INTO users (id, email, handle, display_name, password_hash, created_at, library_visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.email,
    row.handle,
    row.display_name,
    row.password_hash,
    row.created_at,
    row.library_visibility,
  );
  return toUser(row);
}

export function getUserById(db: Db, id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function getUserByHandle(db: Db, handle: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE handle = ?').get(handle) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function authenticate(db: Db, email: string, password: string): User {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw unauthorized('Email or password is incorrect');
  }
  return toUser(row);
}

export function setLibraryVisibility(db: Db, userId: string, visibility: Visibility): void {
  db.prepare('UPDATE users SET library_visibility = ? WHERE id = ?').run(visibility, userId);
}

export function searchUsers(db: Db, query: string, excludeUserId: string, limit = 10): PublicUser[] {
  const like = `%${query.toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE id != ? AND (lower(handle) LIKE ? OR lower(display_name) LIKE ?)
       ORDER BY handle LIMIT ?`,
    )
    .all(excludeUserId, like, like, limit) as unknown as UserRow[];
  return rows.map((row) => toPublicUser(toUser(row)));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(db: Db, userId: string, ttlMs: number): { id: string; expiresAt: string } {
  const id = newToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    new Date(now).toISOString(),
    expiresAt,
  );
  return { id, expiresAt };
}

export function getSessionUser(db: Db, sessionId: string): User | null {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function destroySession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function purgeExpiredSessions(db: Db): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  return Number(result.changes);
}
