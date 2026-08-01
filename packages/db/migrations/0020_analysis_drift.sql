-- How far the book has moved since a report was written.
--
-- The fingerprint already says whether a report is current, but "current" is a
-- yes or a no, and those are two very different noes: a fixed typo and three
-- new chapters both flip it. A writer looking at a spider graph needs to know
-- which, because one is worth ignoring and the other means the graph is about
-- a book that no longer exists.
--
-- So each report keeps a note of what it was judging: every section, with its
-- length and a signature of what the digest found there. Comparing that to the
-- manuscript now gives a quantity — words changed since — rather than a flag,
-- and the panel can say "about 200 words" or "a quarter of the book".
--
-- Null on reports written before this existed. They fall back to the flag.

ALTER TABLE analyses ADD COLUMN digest_snapshot jsonb;

COMMENT ON COLUMN analyses.digest_snapshot IS
  'Per-section [blockId, signature, words] as of the run, for measuring drift.';
