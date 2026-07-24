export const MEDIA_TYPES = ['book', 'movie', 'tv', 'music', 'podcast', 'game'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * One status vocabulary across all media. "liked" is the default because the
 * whole point is to capture the thing a streaming service would otherwise own:
 * the fact that you liked it.
 */
export const STATUSES = ['liked', 'want', 'in_progress', 'done', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];

export const VISIBILITIES = ['private', 'friends', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface Item {
  id: string;
  userId: string;
  mediaType: MediaType;
  title: string;
  creators: string;
  year: number | null;
  status: Status;
  rating: number | null;
  tags: string[];
  notes: string;
  identifiers: Record<string, string>;
  coverUrl: string | null;
  source: string;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface User {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  createdAt: string;
  libraryVisibility: Visibility;
}

export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  libraryVisibility: Visibility;
}

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

export const SYNC_KINDS = ['local', 'gdrive', 'webdav'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export interface SyncTarget {
  id: string;
  userId: string;
  kind: SyncKind;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface SyncRun {
  id: string;
  targetId: string;
  userId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  files: { name: string; bytes: number }[];
  error: string | null;
}

export interface Snapshot {
  id: string;
  userId: string;
  createdAt: string;
  itemCount: number;
  byteSize: number;
  checksum: string;
  reason: string;
  filename: string;
}
