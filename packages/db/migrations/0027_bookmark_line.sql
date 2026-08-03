-- Bookmarks that point at a line, and say what they are for.
--
-- A bookmark has always pointed at a block, which was the right call: a block
-- survives editing where a character offset does not, so an offset-anchored
-- bookmark drifts or dies the first time the paragraph above it is rewritten.
--
-- A paragraph sits between the two. It is stable under ordinary editing —
-- rewriting a sentence does not move it — and only shifts when paragraphs are
-- added or removed above it. So the index is stored with the first few words of
-- the paragraph beside it: if the index no longer lands on that text, the
-- snippet finds it again. Both null means the block as a whole, which is every
-- bookmark that existed before this.
--
-- The description is what the writer wanted to remember about the place, which
-- a name alone rarely holds: "the version where she keeps the letter".

ALTER TABLE bookmarks ADD COLUMN paragraph_index integer;
ALTER TABLE bookmarks ADD COLUMN paragraph_text text;
ALTER TABLE bookmarks ADD COLUMN description text;

ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_paragraph_index_sane
  CHECK (paragraph_index IS NULL OR paragraph_index >= 0);
