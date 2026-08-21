-- Which slot in the official running order this liked song occupies.
--
-- Pairing a liked title to an official one needs the tiered matcher
-- (exact -> feature-stripped -> fuzzy): 'Eyesdown feat. Andreya Triana' and
-- 'Eyesdown' are the same recording. That is import-time work, not something
-- to redo on every request — and a naive equality check in the Worker silently
-- lost 847 matches.
ALTER TABLE items ADD COLUMN track_pos INTEGER;
