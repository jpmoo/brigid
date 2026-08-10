-- Where a note sits on the canvas.
--
-- 0029 hung a note on a side of its node at an offset along that side, on the
-- understanding that notes were dropped from a handle on one of the four
-- edges. That is not what they turned out to be: a note may sit anywhere on the
-- canvas, tethered to its section wherever it lands. A side and an offset
-- cannot say "over there, past two other chapters", so they are replaced by an
-- ordinary position.
--
-- Measured from the corner of the card the note belongs to, so dragging the
-- section carries its notes without touching a row for each one — the same
-- relative scheme canvas_nodes uses, and for the same reason.
--
-- Null on every bookmark not yet placed: the canvas lays those out beside their
-- card the first time it draws them and writes back where it put them, exactly
-- as it does for a block that has never been placed.

ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_note_side_known;
ALTER TABLE bookmarks DROP COLUMN IF EXISTS note_side;
ALTER TABLE bookmarks DROP COLUMN IF EXISTS note_offset;

ALTER TABLE bookmarks ADD COLUMN note_x double precision;
ALTER TABLE bookmarks ADD COLUMN note_y double precision;
