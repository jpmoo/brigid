-- Reading the manuscript so the frameworks have something to judge.
--
-- A novel does not fit in a model's context, and both reference documents ask
-- for whole-story judgments — proportions, whole-story presence, one character
-- weighed against another. So the book is read once, section by section, into a
-- digest: who appeared and what they did, and what happened. The frameworks are
-- then judged against the digest, which does fit.
--
-- The digest is per section and keyed by a hash of what was read. That is the
-- whole staleness mechanism: nothing has to remember to invalidate anything,
-- because a section whose prose has changed no longer matches its row, and the
-- walker looks for exactly that. Edit one scene and one scene is re-read.
--
-- The model is stored alongside, because a different model is a different
-- reader — its digest of chapter 3 is not interchangeable with another's. A
-- change of model makes every row stale, which is expensive and correct.

ALTER TABLE settings ADD COLUMN ollama_num_ctx integer;

COMMENT ON COLUMN settings.ollama_num_ctx IS
  'The model''s full context window, read from Ollama when the model is chosen. '
  'Ollama otherwise serves a small default regardless of what the model can hold.';

CREATE TABLE section_digests (
  block_id uuid PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Of the prose that was read. The row is stale when this stops matching.
  content_hash text NOT NULL,
  -- Which reader produced it.
  model text NOT NULL,

  -- What this section shows of the people in it: appearances, and what they
  -- did, said, wanted, and had done to them — the raw material the ten axes
  -- are scored from, not the scores themselves.
  characters jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What happened, as beats. Position is not stored: it is a fraction of a
  -- whole that changes whenever any other section does, so it is computed when
  -- the digest is read rather than baked in and left to rot.
  events jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- What it cost, kept for the estimate the progress display shows.
  ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX section_digests_work_idx ON section_digests (work_id);

-- The walker's own record: whether it is running for this work, and what went
-- wrong if it stopped. Progress itself is counted from the rows above rather
-- than tracked here, so it cannot drift out of step with them.
CREATE TABLE digest_state (
  work_id uuid PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  -- 'idle' | 'walking' | 'failed'
  status text NOT NULL DEFAULT 'idle',
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE digest_state ADD CONSTRAINT digest_state_status_known
  CHECK (status IN ('idle', 'walking', 'failed'));

-- Findings, kept because they are slow to make.
--
-- An analysis is stamped with a fingerprint of the digest it was made from, so
-- a report can say plainly that the book has moved on since it was written
-- rather than quietly presenting last week's reading of a rewritten chapter.
-- Nothing is invalidated automatically: a stale report is still the best answer
-- available, and deleting it the moment a comma changes would leave the panel
-- empty for no gain.
CREATE TABLE analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  -- 'structure' | 'character'
  kind text NOT NULL,
  -- For 'character', who it is about. Null for 'structure'.
  subject text,
  model text NOT NULL,
  -- Of the digest this was judged from.
  digest_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analyses ADD CONSTRAINT analyses_kind_known
  CHECK (kind IN ('structure', 'character'));

-- One current report per subject. Not a unique constraint: `subject` is null
-- for a structure report, and Postgres treats nulls as distinct, so a unique
-- index would let structure reports pile up while appearing to forbid it. The
-- replacement is done explicitly instead, in a transaction.
CREATE INDEX analyses_work_kind_idx ON analyses (work_id, kind);
