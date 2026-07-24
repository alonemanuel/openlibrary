import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  MEDIA_LABELS,
  MEDIA_TYPES,
  STATUSES,
  STATUS_LABELS,
  VISIBILITIES,
  type Item,
  type ItemEvent,
  type MediaType,
  type Status,
  type Visibility,
} from '../types';
import { Modal, formatDateTime } from './ui';

export interface ItemDraft {
  mediaType: MediaType;
  title: string;
  creators: string;
  year: string;
  status: Status;
  rating: string;
  tags: string;
  notes: string;
  visibility: Visibility;
  coverUrl: string;
}

export function draftFrom(item?: Partial<Item>): ItemDraft {
  return {
    mediaType: item?.mediaType ?? 'book',
    title: item?.title ?? '',
    creators: item?.creators ?? '',
    year: item?.year ? String(item.year) : '',
    status: item?.status ?? 'liked',
    rating: item?.rating ? String(item.rating) : '',
    tags: (item?.tags ?? []).join(', '),
    notes: item?.notes ?? '',
    visibility: item?.visibility ?? 'friends',
    coverUrl: item?.coverUrl ?? '',
  };
}

function toPayload(draft: ItemDraft) {
  return {
    mediaType: draft.mediaType,
    title: draft.title.trim(),
    creators: draft.creators.trim(),
    year: draft.year ? Number(draft.year) : null,
    status: draft.status,
    rating: draft.rating ? Number(draft.rating) : null,
    tags: draft.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    notes: draft.notes,
    visibility: draft.visibility,
    coverUrl: draft.coverUrl.trim() || null,
  };
}

export function ItemEditor({
  item,
  initial,
  onClose,
  onSaved,
  onMessage,
}: {
  /** Present when editing; absent when creating. */
  item?: Item;
  initial?: Partial<Item>;
  onClose: () => void;
  onSaved: () => void;
  onMessage: (message: string, tone?: 'ok' | 'error') => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => draftFrom(item ?? initial));
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<ItemEvent[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!showHistory || !item || history) return;
    void api
      .itemHistory(item.id)
      .then(({ events }) => setHistory(events))
      .catch(() => setHistory([]));
  }, [showHistory, item, history]);

  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!draft.title.trim()) {
      onMessage('A title is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (item) {
        await api.updateItem(item.id, toPayload(draft) as Partial<Item>);
        onMessage('Saved');
      } else {
        const result = await api.createItem(toPayload(draft) as Partial<Item>);
        onMessage(result.duplicate ? 'Already in your library' : 'Added to your library');
      }
      onSaved();
      onClose();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    try {
      await api.deleteItem(item.id);
      // Nothing is actually destroyed — say so, so the wording matches reality.
      onMessage('Removed — still recoverable from Removed items');
      onSaved();
      onClose();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    }
  }

  async function restore() {
    if (!item) return;
    try {
      await api.restoreItem(item.id);
      onMessage('Restored');
      onSaved();
      onClose();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    }
  }

  return (
    <Modal title={item ? 'Edit item' : 'Add to your library'} onClose={onClose}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="editor-type">Type</label>
          <select
            id="editor-type"
            value={draft.mediaType}
            onChange={(event) => set('mediaType', event.target.value as MediaType)}
          >
            {MEDIA_TYPES.map((type) => (
              <option key={type} value={type}>
                {MEDIA_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="editor-status">Status</label>
          <select
            id="editor-status"
            value={draft.status}
            onChange={(event) => set('status', event.target.value as Status)}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="editor-title">Title</label>
        <input
          id="editor-title"
          type="text"
          value={draft.title}
          onChange={(event) => set('title', event.target.value)}
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="editor-creators">Author, artist or director</label>
        <input
          id="editor-creators"
          type="text"
          value={draft.creators}
          onChange={(event) => set('creators', event.target.value)}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="editor-year">Year</label>
          <input
            id="editor-year"
            type="number"
            value={draft.year}
            onChange={(event) => set('year', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="editor-rating">Rating (0–10)</label>
          <input
            id="editor-rating"
            type="number"
            min={0}
            max={10}
            value={draft.rating}
            onChange={(event) => set('rating', event.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="editor-tags">Tags (comma separated)</label>
          <input
            id="editor-tags"
            type="text"
            value={draft.tags}
            onChange={(event) => set('tags', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="editor-visibility">Who can see this</label>
          <select
            id="editor-visibility"
            value={draft.visibility}
            onChange={(event) => set('visibility', event.target.value as Visibility)}
          >
            {VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {visibility === 'private'
                  ? 'Only me'
                  : visibility === 'friends'
                    ? 'Friends'
                    : 'Anyone'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="editor-notes">Notes</label>
        <textarea
          id="editor-notes"
          value={draft.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </div>

      {item ? (
        <div className="field">
          <button className="btn ghost small" onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? 'Hide history' : 'Show history'}
          </button>
          {showHistory ? (
            <div className="list" style={{ marginTop: 10 }}>
              {(history ?? []).map((event) => (
                <div className="row" key={event.id}>
                  <span className="badge">{event.kind}</span>
                  <span className="muted">{formatDateTime(event.createdAt)}</span>
                </div>
              ))}
              {history?.length === 0 ? <span className="muted-note">No history yet.</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="modal-actions">
        {item ? (
          item.deletedAt ? (
            <button className="btn" onClick={restore}>
              Restore
            </button>
          ) : (
            <button className="btn danger" onClick={remove}>
              Remove
            </button>
          )
        ) : null}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" /> : null}
          {item ? 'Save' : 'Add'}
        </button>
      </div>
    </Modal>
  );
}
