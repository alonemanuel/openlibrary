-- Drop the YouTube account split and the music-only flag from liked songs.
--
-- Both were artefacts of how the export was gathered: which of two Google
-- accounts a like came from, and whether the video was on YouTube Music rather
-- than plain YouTube. Neither says anything about the music, and the page no
-- longer offers either filter — every liked row is just a song now.
--
-- items.identifiers is JSON, so this strips the two keys and leaves videoId and
-- seconds untouched. Rows that never carried them are skipped rather than
-- rewritten, so the updated_at story of an untouched library stays honest.
UPDATE items
   SET identifiers = json_remove(identifiers, '$.account', '$.inYtMusic')
 WHERE json_valid(identifiers)
   AND (json_extract(identifiers, '$.account') IS NOT NULL
        OR json_extract(identifiers, '$.inYtMusic') IS NOT NULL);
