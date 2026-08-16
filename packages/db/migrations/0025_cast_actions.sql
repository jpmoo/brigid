-- What the cast actually did, as the writer has settled it.
--
-- Until now the reading was the record: profiles were scored straight off
-- whatever the model wrote down, and a misattributed line or an invented one
-- went into a chart with no chance to catch it. This table puts a step between
-- them. The reading proposes; the writer disposes; profiles are scored only
-- from what has been committed.
--
-- Every row remembers both. `origin_name` and `origin_action` are what the
-- reading said, and they are the identity of the row: re-reading a section that
-- has not changed produces the same pairs and so changes nothing. `character_name`
-- and `action` are what the writer settled on, and start as copies. Moving an
-- action to someone else, or rewording it, edits those and leaves the origin
-- alone, so a re-read can still recognize its own line.
--
-- State is the gate. New material arrives 'pending' and is invisible to
-- profiling until committed; 'dropped' is a line the writer threw out, kept as
-- a row so a re-read does not helpfully offer it again.

CREATE TABLE cast_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,

  -- As the reading recorded it. Together with the block, the row's identity.
  origin_name text NOT NULL,
  origin_action text NOT NULL,

  -- As the writer settled it.
  character_name text NOT NULL,
  action text NOT NULL,

  -- 'pending' | 'committed' | 'dropped'
  state text NOT NULL DEFAULT 'pending',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (work_id, block_id, origin_name, origin_action)
);

ALTER TABLE cast_actions ADD CONSTRAINT cast_actions_state_known
  CHECK (state IN ('pending', 'committed', 'dropped'));

-- The two questions asked of this table: everything for one manuscript, and
-- everything belonging to one character.
CREATE INDEX cast_actions_work_state_idx ON cast_actions (work_id, state);
CREATE INDEX cast_actions_work_character_idx ON cast_actions (work_id, character_name);
