-- How big a note is drawn.
--
-- A note holds whatever the writer needed to say about a place, and that is not
-- a fixed amount: a reminder is a line, a reconsideration of a chapter is a
-- paragraph. Drawn at one size, the long ones are cut off and the short ones
-- take space they do not need.
--
-- Null until it has been resized, which means "whatever the default is" rather
-- than a size of zero — so changing that default later moves every note that
-- was never given one of its own, which is the right behavior.

ALTER TABLE bookmarks ADD COLUMN note_w double precision;
ALTER TABLE bookmarks ADD COLUMN note_h double precision;

ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_note_size_sane
  CHECK (
    (note_w IS NULL OR note_w >= 40) AND
    (note_h IS NULL OR note_h >= 30)
  );
