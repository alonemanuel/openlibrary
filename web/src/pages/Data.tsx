import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Empty, Modal, formatBytes, formatDateTime, useToast } from '../components/ui';
import { MEDIA_LABELS, MEDIA_TYPES, type MediaType, type Snapshot, type SyncRun, type SyncTarget } from '../types';

type Tab = 'export' | 'sync' | 'backups' | 'import';

const KIND_LABELS: Record<string, string> = {
  local: 'Folder on this server',
  gdrive: 'Google Drive',
  webdav: 'WebDAV (Nextcloud, ownCloud…)',
};

export function Data() {
  const [tab, setTab] = useState<Tab>('export');
  const [toast, showToast] = useToast();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sync &amp; backup</h1>
          <p>
            Your library lives in three places at once: here, in whatever storage you point it at,
            and in a backup you can download. Losing any one of them costs you nothing.
          </p>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
          Download
        </button>
        <button className={tab === 'sync' ? 'active' : ''} onClick={() => setTab('sync')}>
          Sync destinations
        </button>
        <button className={tab === 'backups' ? 'active' : ''} onClick={() => setTab('backups')}>
          Backups
        </button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
          Import
        </button>
      </div>

      {tab === 'export' ? <ExportTab /> : null}
      {tab === 'sync' ? <SyncTab onMessage={showToast} /> : null}
      {tab === 'backups' ? <BackupsTab onMessage={showToast} /> : null}
      {tab === 'import' ? <ImportTab onMessage={showToast} /> : null}
      {toast}
    </>
  );
}

// ---------------------------------------------------------------- download

function ExportTab() {
  const [files, setFiles] = useState<{ name: string; bytes: number }[]>([]);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    void api
      .exportListing()
      .then((response) => {
        setFiles(response.files);
        setItemCount(response.itemCount);
      })
      .catch(() => setFiles([]));
  }, []);

  return (
    <>
      <div className="panel">
        <h2>Take your library with you</h2>
        <div className="hint">
          {itemCount} item{itemCount === 1 ? '' : 's'}, written as plain CSV and JSON. No account
          needed to read them — a spreadsheet or a text editor will do. Removed items are included
          and flagged, so your history comes with you too.
        </div>
        <div className="list">
          {files.map((file) => (
            <div className="row" key={file.name}>
              <span className="mono grow">{file.name}</span>
              <span className="muted">{formatBytes(file.bytes)}</span>
              <a className="btn small" href={`/api/export/${file.name}`} download>
                Download
              </a>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Just one kind of thing</h2>
        <div className="hint">A CSV of a single media type, if that is all you need.</div>
        <div className="tag-list">
          {MEDIA_TYPES.map((type) => (
            <a
              key={type}
              className="btn small"
              href={`/api/export/library.csv?type=${type}`}
              download={`${type}.csv`}
            >
              {MEDIA_LABELS[type]}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------------------- sync

function SyncTab({ onMessage }: { onMessage: (message: string, tone?: 'ok' | 'error') => void }) {
  const [targets, setTargets] = useState<SyncTarget[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [targetsResponse, runsResponse] = await Promise.all([api.syncTargets(), api.syncRuns()]);
      setTargets(targetsResponse.targets);
      setRuns(runsResponse.runs);
    } catch (error) {
      onMessage((error as Error).message, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(target: SyncTarget) {
    setRunning(target.id);
    try {
      const response = await api.runSync(target.id);
      if (response.result.status === 'ok') {
        onMessage(`Wrote ${response.result.files.length} files to ${target.name}`);
      } else {
        onMessage(response.result.error ?? 'Sync failed', 'error');
      }
    } catch (error) {
      onMessage((error as Error).message, 'error');
    } finally {
      setRunning(null);
      await load();
    }
  }

  async function remove(target: SyncTarget) {
    try {
      await api.deleteSyncTarget(target.id);
      onMessage('Destination removed — the files already written stay where they are');
      await load();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Where your copies go</h2>
            <div className="hint">
              Every destination gets the same export bundle, rewritten in place on each run.
              Scheduled automatically, and you can push at any time.
            </div>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Add destination
          </button>
        </div>

        {targets.length === 0 ? (
          <Empty
            icon="🗂️"
            title="No destinations yet"
            hint="A folder on this server is the simplest: point it at a directory your Drive or Dropbox client already watches."
          />
        ) : (
          <div className="list">
            {targets.map((target) => (
              <div className="row" key={target.id}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    {target.name}{' '}
                    <span className="badge">{KIND_LABELS[target.kind] ?? target.kind}</span>
                  </div>
                  <div className="muted">{target.description}</div>
                  {target.lastError ? (
                    <div className="muted" style={{ color: 'var(--danger)' }}>
                      {target.lastError}
                    </div>
                  ) : null}
                </div>
                <span className={`badge ${target.lastStatus === 'ok' ? 'accent' : target.lastStatus === 'error' ? 'danger' : ''}`}>
                  {target.lastStatus === 'ok'
                    ? `Synced ${formatDateTime(target.lastRunAt)}`
                    : target.lastStatus === 'error'
                      ? 'Last run failed'
                      : 'Never run'}
                </span>
                <button className="btn small" onClick={() => run(target)} disabled={running === target.id}>
                  {running === target.id ? <span className="spinner" /> : null} Sync now
                </button>
                <button className="btn danger small" onClick={() => remove(target)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {runs.length > 0 ? (
        <div className="panel">
          <h2>Recent runs</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {runs.slice(0, 10).map((run) => (
              <div className="row" key={run.id}>
                <span className={`badge ${run.status === 'ok' ? 'accent' : 'danger'}`}>
                  {run.status}
                </span>
                <span className="grow muted">
                  {formatDateTime(run.startedAt)} ·{' '}
                  {run.status === 'ok' ? `${run.files.length} files` : run.error}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {creating ? (
        <NewTargetModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
            onMessage('Destination added');
          }}
          onMessage={onMessage}
        />
      ) : null}
    </>
  );
}

function NewTargetModal({
  onClose,
  onCreated,
  onMessage,
}: {
  onClose: () => void;
  onCreated: () => void;
  onMessage: (message: string, tone?: 'ok' | 'error') => void;
}) {
  const [kind, setKind] = useState<'local' | 'gdrive' | 'webdav'>('local');
  const [name, setName] = useState('My library copy');
  const [folder, setFolder] = useState('open-library');
  const [driveFolder, setDriveFolder] = useState('Open Library');
  const [url, setUrl] = useState('');
  const [fields, setFields] = useState({
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    username: '',
    password: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof fields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function submit() {
    setSaving(true);
    try {
      const payload: {
        kind: string;
        name: string;
        config: Record<string, unknown>;
        secrets?: Record<string, string>;
      } =
        kind === 'local'
          ? { kind, name, config: { path: folder } }
          : kind === 'gdrive'
            ? {
                kind,
                name,
                config: { folderName: driveFolder },
                secrets: {
                  clientId: fields.clientId,
                  clientSecret: fields.clientSecret,
                  refreshToken: fields.refreshToken,
                },
              }
            : {
                kind,
                name,
                config: { url },
                secrets: { username: fields.username, password: fields.password },
              };
      await api.createSyncTarget(payload);
      onCreated();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a sync destination" onClose={onClose}>
      <div className="field">
        <label htmlFor="target-kind">Type</label>
        <select
          id="target-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="target-name">Name</label>
        <input id="target-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </div>

      {kind === 'local' ? (
        <div className="field">
          <label htmlFor="target-folder">Folder</label>
          <input
            id="target-folder"
            type="text"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
          <span className="muted-note">
            Relative to the server's sync root (OPENLIB_SYNC_ROOT). Point that at a folder your
            Drive, Dropbox or Syncthing client already watches and the CSVs travel on their own.
          </span>
        </div>
      ) : null}

      {kind === 'gdrive' ? (
        <>
          <div className="field">
            <label htmlFor="target-drive-folder">Drive folder name</label>
            <input
              id="target-drive-folder"
              type="text"
              value={driveFolder}
              onChange={(event) => setDriveFolder(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="target-client-id">OAuth client ID</label>
            <input
              id="target-client-id"
              type="text"
              value={fields.clientId}
              onChange={(event) => set('clientId', event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="target-client-secret">OAuth client secret</label>
            <input
              id="target-client-secret"
              type="password"
              value={fields.clientSecret}
              onChange={(event) => set('clientSecret', event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="target-refresh">Refresh token</label>
            <input
              id="target-refresh"
              type="password"
              value={fields.refreshToken}
              onChange={(event) => set('refreshToken', event.target.value)}
            />
            <span className="muted-note">
              Credentials are encrypted before they are stored and never sent back to the browser.
              Revoking access in your Google account stops the sync immediately.
            </span>
          </div>
        </>
      ) : null}

      {kind === 'webdav' ? (
        <>
          <div className="field">
            <label htmlFor="target-url">WebDAV URL</label>
            <input
              id="target-url"
              type="text"
              placeholder="https://cloud.example.com/remote.php/dav/files/me/library"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="target-user">Username</label>
              <input
                id="target-user"
                type="text"
                value={fields.username}
                onChange={(event) => set('username', event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="target-pass">Password</label>
              <input
                id="target-pass"
                type="password"
                value={fields.password}
                onChange={(event) => set('password', event.target.value)}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={saving}>
          {saving ? <span className="spinner" /> : null} Add destination
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- backups

function BackupsTab({ onMessage }: { onMessage: (message: string, tone?: 'ok' | 'error') => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshots((await api.snapshots()).snapshots);
    } catch (error) {
      onMessage((error as Error).message, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function snapshot() {
    setBusy(true);
    try {
      const response = await api.createSnapshot();
      onMessage(response.unchanged ? 'Nothing has changed since the last backup' : 'Backup taken');
      await load();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function restore(snapshot: Snapshot) {
    if (
      !window.confirm(
        'Restore this backup? Items in it are added back or updated. Anything you have added since is left alone.',
      )
    ) {
      return;
    }
    try {
      const response = await api.restoreSnapshot(snapshot.id);
      onMessage(
        `Restored: ${response.result.created} added back, ${response.result.updated} updated`,
      );
      await load();
    } catch (error) {
      onMessage((error as Error).message, 'error');
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Backups kept here</h2>
          <div className="hint">
            A full copy of your library, taken daily and whenever you ask. Identical backups are not
            duplicated, and restoring only ever adds things back — it never removes what you have
            since added.
          </div>
        </div>
        <button className="btn primary" onClick={snapshot} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Back up now
        </button>
      </div>

      {snapshots.length === 0 ? (
        <Empty icon="🛟" title="No backups yet" hint="Take one now, or add an item and wait a day." />
      ) : (
        <div className="list">
          {snapshots.map((snapshot) => (
            <div className="row" key={snapshot.id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{formatDateTime(snapshot.createdAt)}</div>
                <div className="muted">
                  {snapshot.itemCount} items · {formatBytes(snapshot.byteSize)} ·{' '}
                  <span className="mono">{snapshot.checksum.slice(0, 12)}</span>
                </div>
              </div>
              <span className="badge">{snapshot.reason.replace('_', ' ')}</span>
              <a className="btn small" href={`/api/snapshots/${snapshot.id}/download`} download>
                Download
              </a>
              <button className="btn small" onClick={() => restore(snapshot)}>
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- import

function ImportTab({ onMessage }: { onMessage: (message: string, tone?: 'ok' | 'error') => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [mediaType, setMediaType] = useState<MediaType | ''>('');
  const [updateExisting, setUpdateExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    format: string;
    created: number;
    updated: number;
    skipped: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const content = await file.text();
      const response = await api.importFile(file.name, content, {
        ...(mediaType ? { mediaType } : {}),
        updateExisting,
      });
      setResult(response.result);
      onMessage(`Imported ${response.result.created} new items`);
    } catch (error) {
      onMessage((error as Error).message, 'error');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <>
      <div className="panel">
        <h2>Bring a library in</h2>
        <div className="hint">
          Goodreads and Letterboxd exports are understood as they come. So is any CSV with
          recognisable columns, and any export this app has produced. Matching items are found by
          their identifiers first, then title and year, so importing twice will not double anything.
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="import-type">Treat rows as</label>
            <select
              id="import-type"
              value={mediaType}
              onChange={(event) => setMediaType(event.target.value as MediaType | '')}
            >
              <option value="">Detect automatically</option>
              {MEDIA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MEDIA_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="import-update">If an item already exists</label>
            <select
              id="import-update"
              value={updateExisting ? 'update' : 'skip'}
              onChange={(event) => setUpdateExisting(event.target.value === 'update')}
            >
              <option value="skip">Leave mine as it is</option>
              <option value="update">Merge the imported details in</option>
            </select>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {busy ? <div className="hint" style={{ marginTop: 10 }}><span className="spinner" /> Importing…</div> : null}
      </div>

      {result ? (
        <div className="panel">
          <h2>Import finished</h2>
          <div className="stat-row" style={{ marginTop: 12 }}>
            <div className="stat">
              <div className="value">{result.created}</div>
              <div className="label">added</div>
            </div>
            <div className="stat">
              <div className="value">{result.updated}</div>
              <div className="label">updated</div>
            </div>
            <div className="stat">
              <div className="value">{result.skipped}</div>
              <div className="label">already there</div>
            </div>
            <div className="stat">
              <div className="value">{result.format}</div>
              <div className="label">format detected</div>
            </div>
          </div>
          {result.errors.length > 0 ? (
            <div className="alert warn">
              {result.errors.length} row{result.errors.length === 1 ? '' : 's'} could not be read —
              first problem on line {result.errors[0]!.row}: {result.errors[0]!.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
