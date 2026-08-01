-- Spelling: the switch, and the words the writer has taught it.
--
-- A novel is full of words no dictionary has — names, places, invented things —
-- and the whole value of a checker is that it stops flagging them once told.
-- So the personal dictionary is the writer's own data and lives here, not in
-- the browser's or the operating system's, both of which are outside the app's
-- reach and neither of which follows them to another machine.
--
-- The setting is system-wide rather than per-work: it describes how the writer
-- likes to work, not something about any one manuscript.

ALTER TABLE settings ADD COLUMN spellcheck_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE dictionary_words (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- As typed, which is how it's shown back in the list: "Maren", not "maren".
  word       text NOT NULL,
  -- Case-folded, and the uniqueness key. Teaching it "Maren" also settles
  -- "maren" and "MAREN" — nobody wants to add a name three times.
  word_folded text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dictionary_words_sort_idx ON dictionary_words (word_folded);
