-- When this song was added to the library, as opposed to when the import ran.
--
-- items.created_at cannot answer this: the importer stamps every row in a run
-- with the same timestamp, so ordering by it returns the CSV's order wearing a
-- date.
--
-- A timestamp rather than a position in the liked list, deliberately. A
-- position is not a fact about a song: unlike one thing and every position
-- after it shifts, so a stored rank is wrong the moment the library changes,
-- cannot be merged across two accounts, and cannot be compared between
-- imports. An instant is immutable and survives all three.
--
-- Nullable on purpose, and most rows will be null. Google keeps no per-like
-- timestamp that can be retrieved, so this is only populated where some other
-- record pins the moment down. A song nothing accounts for keeps NULL rather
-- than a guessed date, and the page files those last.
ALTER TABLE items ADD COLUMN liked_at TEXT;
CREATE INDEX items_liked_at ON items (user_id, liked_at);
