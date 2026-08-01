-- The story-shape analysis, moved off the request.
--
-- This one is a single model call rather than a dozen, so it fitted inside a
-- request where character profiling never could. But "fitted" was only ever
-- true of a book the model could get through in under a hundred seconds, and it
-- tied the analysis to a page nobody could leave — close the tab and the work
-- is abandoned with nothing to show for it.
--
-- Same shape as character_runs, minus the queue: there is one thing to do, so
-- the row records only whether it is being done.

CREATE TABLE structure_runs (
  work_id uuid PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  -- 'queued' | 'running' | 'idle' | 'failed'
  status text NOT NULL DEFAULT 'queued',
  digest_fingerprint text,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE structure_runs ADD CONSTRAINT structure_runs_status_known
  CHECK (status IN ('queued', 'running', 'idle', 'failed'));
