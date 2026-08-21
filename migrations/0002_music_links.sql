-- What the page needs that the first pass didn't capture.
--
-- A credit names several acts ("Vibe Ish, Roisha"), so the link from a song to
-- its artists is many-to-many and cannot live in items.creators as text. Same
-- for an album, which shows on every credited artist's page.

CREATE TABLE item_artists (
  item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  music_key TEXT NOT NULL,          -- media_assets.music_key, kind='artist'
  position  INTEGER NOT NULL,       -- 0 is the lead act
  PRIMARY KEY (item_id, music_key)
);
CREATE INDEX item_artists_key ON item_artists (music_key);

CREATE TABLE album_artists (
  album_key  TEXT NOT NULL,         -- media_assets.music_key, kind='album'
  artist_key TEXT NOT NULL,         -- media_assets.music_key, kind='artist'
  position   INTEGER NOT NULL,
  PRIMARY KEY (album_key, artist_key)
);
CREATE INDEX album_artists_artist ON album_artists (artist_key);

-- Both image sizes are distinct objects in R2, so one URL cannot serve both.
ALTER TABLE media_assets ADD COLUMN image_sm_url TEXT;
-- The Latin form of a native-script name, shown under it and searchable.
ALTER TABLE media_assets ADD COLUMN latin_name TEXT;
