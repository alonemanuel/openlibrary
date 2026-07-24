import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ItemFilters } from '../api';
import { ItemCard } from '../components/ItemCard';
import { ItemEditor } from '../components/ItemEditor';
import { Empty, useToast } from '../components/ui';
import {
  MEDIA_LABELS,
  MEDIA_TYPES,
  STATUSES,
  STATUS_LABELS,
  type Item,
  type MediaType,
  type Stats,
  type Status,
} from '../types';

export function Library() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, showToast] = useToast();

  const filters: ItemFilters = {
    type: (params.get('type') as MediaType | null) ?? '',
    status: (params.get('status') as Status | null) ?? '',
    q: params.get('q') ?? '',
    tag: params.get('tag') ?? '',
    sort: params.get('sort') ?? 'added_desc',
    deleted: params.get('deleted') === '1',
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsResponse, statsResponse] = await Promise.all([
        api.items(filters),
        api.stats(),
      ]);
      setItems(itemsResponse.items);
      setStats(statsResponse.stats);
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const showingRemoved = filters.deleted;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{showingRemoved ? 'Removed items' : 'Your library'}</h1>
          <p>
            {showingRemoved
              ? 'Removing something never destroys it. Everything here can be restored, and it stays in your exports marked as removed.'
              : 'Everything you have saved, in one place — and in a format you can walk away with.'}
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          + Add item
        </button>
      </div>

      {stats && !showingRemoved ? (
        <div className="stat-row">
          <div className="stat">
            <div className="value">{stats.total}</div>
            <div className="label">items kept</div>
          </div>
          {MEDIA_TYPES.filter((type) => stats.byMediaType[type]).map((type) => (
            <div className="stat" key={type}>
              <div className="value">{stats.byMediaType[type]}</div>
              <div className="label">{MEDIA_LABELS[type].toLowerCase()}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search titles, people, notes…"
          value={filters.q}
          onChange={(event) => setParam('q', event.target.value)}
        />
        <select value={filters.type} onChange={(event) => setParam('type', event.target.value)}>
          <option value="">All types</option>
          {MEDIA_TYPES.map((type) => (
            <option key={type} value={type}>
              {MEDIA_LABELS[type]}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(event) => setParam('status', event.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select value={filters.sort} onChange={(event) => setParam('sort', event.target.value)}>
          <option value="added_desc">Newest first</option>
          <option value="added_asc">Oldest first</option>
          <option value="title">Title</option>
          <option value="rating">Rating</option>
          <option value="year">Year</option>
        </select>
        <button
          className="btn small"
          onClick={() => setParam('deleted', showingRemoved ? '' : '1')}
        >
          {showingRemoved ? 'Back to library' : `Removed${stats?.deleted ? ` (${stats.deleted})` : ''}`}
        </button>
      </div>

      {filters.tag ? (
        <div style={{ marginBottom: 14 }}>
          <span className="badge accent">
            #{filters.tag}
            <button
              className="btn ghost small"
              style={{ padding: '0 2px' }}
              onClick={() => setParam('tag', '')}
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}

      {stats?.topTags.length && !filters.tag && !showingRemoved ? (
        <div className="tag-list" style={{ marginBottom: 16 }}>
          {stats.topTags.map((tag) => (
            <button key={tag.tag} className="badge" onClick={() => setParam('tag', tag.tag)}>
              #{tag.tag} · {tag.count}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="empty">
          <span className="spinner" />
        </div>
      ) : items.length === 0 ? (
        <Empty
          icon={showingRemoved ? '🗑️' : '📚'}
          title={showingRemoved ? 'Nothing removed' : 'Your library is empty'}
          hint={
            showingRemoved
              ? 'Items you remove will wait here rather than disappearing.'
              : 'Add something by hand, search the catalogue, or import a CSV from a service you are leaving.'
          }
        />
      ) : (
        <div className="grid">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onClick={() => setEditing(item)} />
          ))}
        </div>
      )}

      {creating ? (
        <ItemEditor
          onClose={() => setCreating(false)}
          onSaved={load}
          onMessage={showToast}
        />
      ) : null}
      {editing ? (
        <ItemEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
          onMessage={showToast}
        />
      ) : null}
      {toast}
    </>
  );
}
