CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        handle        TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        library_visibility TEXT NOT NULL DEFAULT 'friends'
      );
CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE items (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type  TEXT NOT NULL,
        title       TEXT NOT NULL,
        creators    TEXT NOT NULL DEFAULT '',
        year        INTEGER,
        status      TEXT NOT NULL DEFAULT 'liked',
        rating      INTEGER,
        tags        TEXT NOT NULL DEFAULT '[]',
        notes       TEXT NOT NULL DEFAULT '',
        identifiers TEXT NOT NULL DEFAULT '{}',
        cover_url   TEXT,
        source      TEXT NOT NULL DEFAULT 'manual',
        visibility  TEXT NOT NULL DEFAULT 'friends',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );
CREATE INDEX items_user_idx ON items(user_id, deleted_at);
CREATE INDEX items_type_idx ON items(user_id, media_type);
CREATE TABLE item_events (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        payload    TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
CREATE INDEX item_events_item_idx ON item_events(item_id);
CREATE INDEX item_events_user_idx ON item_events(user_id, created_at);
CREATE TABLE friendships (
        id           TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE (requester_id, addressee_id)
      );
CREATE INDEX friendships_addressee_idx ON friendships(addressee_id, status);
CREATE TABLE sync_targets (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL,
        name         TEXT NOT NULL,
        config       TEXT NOT NULL DEFAULT '{}',
        secrets      TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL,
        last_run_at  TEXT,
        last_status  TEXT,
        last_error   TEXT
      );
CREATE INDEX sync_targets_user_idx ON sync_targets(user_id);
CREATE TABLE sync_runs (
        id          TEXT PRIMARY KEY,
        target_id   TEXT NOT NULL REFERENCES sync_targets(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL,
        files       TEXT NOT NULL DEFAULT '[]',
        error       TEXT
      );
CREATE INDEX sync_runs_target_idx ON sync_runs(target_id, started_at);
CREATE TABLE snapshots (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        byte_size  INTEGER NOT NULL,
        checksum   TEXT NOT NULL,
        reason     TEXT NOT NULL DEFAULT 'manual',
        filename   TEXT NOT NULL
      );
CREATE INDEX snapshots_user_idx ON snapshots(user_id, created_at);
CREATE TABLE IF NOT EXISTS schema_migrations (
    id         TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
