export const MEDIA_TYPES = ['book', 'movie', 'tv', 'music', 'podcast', 'game'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

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

export interface Me {
  id: string;
  handle: string;
  email: string;
  displayName: string;
  libraryVisibility: Visibility;
}

export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  libraryVisibility: Visibility;
}

export interface Stats {
  total: number;
  deleted: number;
  byMediaType: Record<string, number>;
  byStatus: Record<string, number>;
  topTags: { tag: string; count: number }[];
}

export interface FriendEntry {
  friendshipId: string;
  user: PublicUser;
  since: string;
}

export interface PendingRequest {
  friendshipId: string;
  user: PublicUser;
  requestedAt: string;
}

export interface CatalogResult {
  mediaType: MediaType;
  title: string;
  creators: string;
  year: number | null;
  coverUrl: string | null;
  identifiers: Record<string, string>;
  provider: string;
  detail?: string;
}

export type SyncKind = 'local' | 'gdrive' | 'webdav';

export interface SyncTarget {
  id: string;
  kind: SyncKind;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  description?: string;
}

export interface SyncRun {
  id: string;
  targetId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  files: { name: string; bytes: number }[];
  error: string | null;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  itemCount: number;
  byteSize: number;
  checksum: string;
  reason: string;
}

export interface ItemEvent {
  id: string;
  itemId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const MEDIA_LABELS: Record<MediaType, string> = {
  book: 'Books',
  movie: 'Films',
  tv: 'TV',
  music: 'Music',
  podcast: 'Podcasts',
  game: 'Games',
};

export const MEDIA_ICONS: Record<MediaType, string> = {
  book: '📖',
  movie: '🎬',
  tv: '📺',
  music: '🎵',
  podcast: '🎙️',
  game: '🎮',
};

export const STATUS_LABELS: Record<Status, string> = {
  liked: 'Liked',
  want: 'Want to',
  in_progress: 'In progress',
  done: 'Finished',
  dropped: 'Dropped',
};
