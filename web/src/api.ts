import type {
  CatalogResult,
  FriendEntry,
  Item,
  ItemEvent,
  MediaType,
  Me,
  PendingRequest,
  PublicUser,
  Snapshot,
  Stats,
  Status,
  SyncRun,
  SyncTarget,
  Visibility,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = contentType ?? 'application/json';

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

  const text = await response.text();
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const parsed = isJson && text ? JSON.parse(text) : text;

  if (!response.ok) {
    const error = (parsed as { error?: { message?: string; code?: string } })?.error;
    throw new ApiError(response.status, error?.message ?? `Request failed (${response.status})`, error?.code);
  }
  return parsed as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

/**
 * Anything that changes the library announces it, so counts elsewhere on the
 * page (the sidebar, mainly) correct themselves without a reload.
 */
export const LIBRARY_CHANGED = 'openlibrary:changed';

async function mutating<T>(work: Promise<T>): Promise<T> {
  const result = await work;
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED));
  return result;
}

export interface ItemFilters {
  type?: MediaType | '';
  status?: Status | '';
  tag?: string;
  q?: string;
  deleted?: boolean;
  sort?: string;
}

function itemQuery(filters: ItemFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q) params.set('q', filters.q);
  if (filters.deleted) params.set('deleted', '1');
  if (filters.sort) params.set('sort', filters.sort);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const api = {
  // -- auth
  me: () => get<{ user: Me | null }>('/api/auth/me'),
  login: (email: string, password: string) =>
    post<{ user: Me }>('/api/auth/login', { email, password }),
  register: (input: { email: string; password: string; handle: string; displayName?: string }) =>
    post<{ user: Me }>('/api/auth/register', input),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  updateProfile: (input: { displayName?: string; libraryVisibility?: Visibility }) =>
    patch<{ user: Me }>('/api/auth/me', input),

  // -- library
  items: (filters: ItemFilters = {}) =>
    get<{ items: Item[]; total: number }>(`/api/items${itemQuery(filters)}`),
  createItem: (input: Partial<Item>) =>
    mutating(post<{ item: Item; duplicate: boolean }>('/api/items', input)),
  updateItem: (id: string, patchBody: Partial<Item>) =>
    mutating(patch<{ item: Item }>(`/api/items/${id}`, patchBody)),
  deleteItem: (id: string) => mutating(del<{ item: Item }>(`/api/items/${id}`)),
  restoreItem: (id: string) => mutating(post<{ item: Item }>(`/api/items/${id}/restore`)),
  itemHistory: (id: string) => get<{ events: ItemEvent[] }>(`/api/items/${id}/history`),
  stats: () => get<{ stats: Stats }>('/api/stats'),
  activity: (limit = 50) => get<{ events: ItemEvent[] }>(`/api/activity?limit=${limit}`),

  // -- catalog
  searchCatalog: (type: MediaType, q: string) =>
    get<{ results: CatalogResult[]; warnings: string[] }>(
      `/api/catalog/search?type=${type}&q=${encodeURIComponent(q)}`,
    ),

  // -- friends
  friends: () =>
    get<{
      friends: FriendEntry[];
      requests: { incoming: PendingRequest[]; outgoing: PendingRequest[] };
    }>('/api/friends'),
  searchPeople: (q: string) =>
    get<{ users: PublicUser[] }>(`/api/friends/search?q=${encodeURIComponent(q)}`),
  addFriend: (handle: string) => post<unknown>('/api/friends/requests', { handle }),
  acceptFriend: (friendshipId: string) =>
    post<unknown>(`/api/friends/requests/${friendshipId}/accept`),
  removeFriend: (friendshipId: string) => del<unknown>(`/api/friends/${friendshipId}`),
  friendLibrary: (handle: string, filters: ItemFilters = {}) =>
    get<{ user: PublicUser; access: string; items: Item[] }>(
      `/api/users/${handle}${itemQuery(filters)}`,
    ),

  // -- data: export, import, sync, backup
  exportListing: () =>
    get<{ generatedAt: string; itemCount: number; files: { name: string; bytes: number }[] }>(
      '/api/export',
    ),
  importFile: (filename: string, content: string, options: { mediaType?: MediaType; updateExisting?: boolean } = {}) =>
    mutating(post<{ result: { format: string; created: number; updated: number; skipped: number; errors: { row: number; message: string }[] } }>(
      '/api/import',
      { filename, content, ...options },
    )),

  syncTargets: () => get<{ targets: SyncTarget[]; kinds: string[] }>('/api/sync/targets'),
  createSyncTarget: (input: {
    kind: string;
    name: string;
    config: Record<string, unknown>;
    secrets?: Record<string, string>;
  }) => post<{ target: SyncTarget }>('/api/sync/targets', input),
  updateSyncTarget: (id: string, input: Record<string, unknown>) =>
    patch<{ target: SyncTarget }>(`/api/sync/targets/${id}`, input),
  deleteSyncTarget: (id: string) => del<{ ok: true }>(`/api/sync/targets/${id}`),
  runSync: (id: string) =>
    post<{ result: { status: string; files: { name: string; bytes: number }[]; error?: string } }>(
      `/api/sync/targets/${id}/run`,
    ),
  syncRuns: () => get<{ runs: SyncRun[] }>('/api/sync/runs'),

  snapshots: () => get<{ snapshots: Snapshot[] }>('/api/snapshots'),
  createSnapshot: () => post<{ snapshot: Snapshot; unchanged: boolean }>('/api/snapshots'),
  restoreSnapshot: (id: string) =>
    mutating(
      post<{ result: { created: number; updated: number; skipped: number } }>(
        `/api/snapshots/${id}/restore`,
      ),
    ),
};
