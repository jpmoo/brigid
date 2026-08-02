-- Entries the writer has ruled are not characters.
--
-- A digest asked "who is in this section" answers with whoever it can name, and
-- some of those are not people: a crowd, a ship, a title used as a name, an
-- abstraction the prose personifies for a paragraph. The bare role words are
-- caught by a list in code, but the interesting cases are particular to a book
-- and only its writer can settle them.
--
-- Recording the judgment rather than acting on it once matters, because the
-- walker re-reads changed sections and would otherwise reintroduce the same
-- entry every time the chapter it came from was edited. Folded and raw are both
-- kept: folded is what the roster matches on, raw is what the writer saw.
--
-- Deleting the row is how the judgment is undone; the name comes back on the
-- next read of any section that mentions it.

CREATE TABLE excluded_characters (
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  -- The roster's key: lowercased, depunctuated, counting words stripped.
  name_folded text NOT NULL,
  -- As it was shown when the writer ruled on it.
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id, name_folded)
);
