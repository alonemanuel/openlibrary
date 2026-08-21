-- Shared music metadata: identical for every user, so it is looked up by
-- music identity rather than by user_id. One person's cover fetch benefits
-- everyone; per-user rows in `items` reference these, never duplicate them.
--
-- music_key is the identity we can actually resolve, best available first:
--   isrc:<code>   a recording, from Spotify — near-total coverage, ISO 3901
--   upc:<code>    a release
--   mbid:<uuid>   MusicBrainz — only ~30% coverage on Hebrew catalogue
--   name:<artist>|<title>  normalised fallback for YouTube-only uploads,
--                          which were never commercially released and so
--                          carry no identifier at all
--
-- Normalisation for name: keys matters. Casing and accents do not make a
-- different album, and one user's export writing "BONOBO" must hit the same
-- row as another's "Bonobo", or the cache stops being shared.

CREATE TABLE media_assets (
  music_key    TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,              -- 'album' | 'artist'
  display_name TEXT NOT NULL,              -- native script, for display
  slug         TEXT NOT NULL,              -- ASCII, for URLs
  image_key    TEXT,                       -- R2 object key, content-addressed
  image_source TEXT,                       -- 'deezer' | 'itunes' | 'musicbrainz'
  source_url   TEXT,                       -- origin, for re-mirroring
  release_type TEXT,                       -- 'album' | 'single' | 'ep' | 'compilation'
  n_tracks     INTEGER,
  checked_at   TEXT NOT NULL,
  UNIQUE (kind, slug)
);
CREATE INDEX media_assets_kind ON media_assets (kind);

-- Official running order, so an album page can grey out tracks nobody liked.
-- Guarded on write: a tracklist whose length disagrees with n_tracks means we
-- resolved to the wrong release (an album and its lead single share a title).
CREATE TABLE release_tracks (
  music_key TEXT NOT NULL REFERENCES media_assets(music_key) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  title     TEXT NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  isrc      TEXT,
  PRIMARY KEY (music_key, position)
);

-- Text query -> provider track id. Global because the answer to
-- "what is Bonobo – El Toro on YouTube Music" is the same for everyone.
CREATE TABLE resolutions (
  query      TEXT NOT NULL,
  provider   TEXT NOT NULL,               -- 'ytmusic' | 'spotify'
  track_id   TEXT,                        -- NULL records a confirmed miss
  title      TEXT,
  artist     TEXT,
  seconds    INTEGER,
  resolved_at TEXT NOT NULL,
  PRIMARY KEY (query, provider)
);

-- Curated romanisations. Hebrew script omits vowels, so transliteration alone
-- yields consonant soup ("hkl-v-klvm"); these are the reviewed forms.
CREATE TABLE name_translations (
  source_name TEXT PRIMARY KEY,
  english     TEXT NOT NULL,
  reviewed    INTEGER NOT NULL DEFAULT 0
);

-- Link a user's item to shared metadata without duplicating any of it.
ALTER TABLE items ADD COLUMN music_key TEXT;
CREATE INDEX items_music_key ON items (music_key);
