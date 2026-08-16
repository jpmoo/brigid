-- ProseDNA: what a writer's hand measures out to.
--
-- Two hundred-odd numbers per section — sentence architecture, punctuation,
-- function words, how speech is attributed, how far the narrator stands from
-- the scene. All of it arithmetic, so unlike the digest this needs no model and
-- runs whether or not one is connected. A manuscript with Ollama switched off
-- still has a fingerprint.
--
-- Keyed on a hash of what was measured, the same way the digest is: a section
-- whose prose has changed no longer matches its row and is re-measured, and
-- nothing has to remember to invalidate anything. Unlike the digest there is no
-- model column, because no model was involved and two readers would produce the
-- same numbers.
--
-- What is deliberately absent is any comparison. No baseline, no z-score, no
-- "unusual" flag. A baseline is an average over whichever sections the writer
-- counts towards their normal, and that changes the moment a chapter is
-- excluded — so a stored comparison would describe a corpus that no longer
-- exists. Only the raw measurements are kept, and everything relative is worked
-- out on reading. The same reasoning 0017 gives for not storing an event's
-- position in the story.

CREATE TABLE style_features (
  block_id uuid PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Of the prose that was measured. The row is stale when this stops matching.
  content_hash text NOT NULL,

  -- What the section is made of, kept out of the feature blobs because the
  -- reading side needs them for weighting and for deciding whether a section is
  -- long enough to draw a conclusion from.
  words integer NOT NULL,
  sentences integer NOT NULL,
  paragraphs integer NOT NULL,
  dialogue_share double precision NOT NULL,

  -- The features themselves, three ways: everything, and then what is spoken
  -- and what is not held apart. A scene that is mostly dialogue differs from a
  -- scene that is mostly narration in every feature at once, and comparing the
  -- two against one baseline would report that as a change of voice.
  overall jsonb NOT NULL DEFAULT '{}'::jsonb,
  narration jsonb NOT NULL DEFAULT '{}'::jsonb,
  dialogue jsonb NOT NULL DEFAULT '{}'::jsonb,

  measured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX style_features_work ON style_features (work_id);

COMMENT ON TABLE style_features IS
  'Per-section measurements of the writing itself. Raw only: anything relative '
  'to a corpus is computed when read, because the corpus changes with a click.';

-- Which sections count towards the writer's normal, and which voice they are
-- written in.
--
-- Everything structural counts unless it is excluded — less friction than
-- opting each section in, and the fingerprint is useful from the first scan.
-- The cost is that a rough new chapter quietly joins the baseline until it is
-- excluded, which is what the corpus pane is for.
--
-- A voice is a section that is meant to read differently: a letter, a dream, a
-- second narrator. Measured against the book's ordinary prose these fill the
-- report with a difference the writer already knows about, so each voice gets
-- its own normal once there is enough of it to have one.
ALTER TABLE blocks ADD COLUMN style_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE blocks ADD COLUMN style_voice text;

ALTER TABLE blocks ADD CONSTRAINT blocks_style_voice_length
  CHECK (style_voice IS NULL OR char_length(style_voice) BETWEEN 1 AND 60);

COMMENT ON COLUMN blocks.style_excluded IS
  'Kept out of the ProseDNA baseline. Still measured — a draft is exactly what '
  'someone wants to ask "does this sound like me yet?" about.';

-- What the model made of it.
--
-- One per manuscript. The card is prose the writer can edit, because it is what
-- steers everything downstream and a description of a voice that its owner
-- disagrees with is worse than none.
--
-- The corpus signature is what it was written from: which sections were
-- included and how long they were. When that stops matching, the card is not
-- wrong exactly, but it was written about a different book, and the pane says
-- so rather than quietly presenting it as current.
CREATE TABLE style_profiles (
  work_id uuid PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,

  -- The voice in prose, as the model described it and the writer left it.
  card text NOT NULL DEFAULT '',
  -- True once a person has touched it, so a regeneration can refuse to
  -- overwrite what was edited without being asked.
  card_edited boolean NOT NULL DEFAULT false,

  -- Sections closest to the middle of everything included: what the model is
  -- shown when it is asked to sound like this writer. Ids, not prose, so they
  -- follow the manuscript rather than going stale against it.
  exemplars jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Longer commentary: what the numbers say, in paragraphs.
  commentary jsonb NOT NULL DEFAULT '[]'::jsonb,

  model text,
  corpus_signature text,
  generated_at timestamptz
);

COMMENT ON TABLE style_profiles IS
  'The model''s reading of the measurements, and the writer''s edit of it.';
