-- Profiling the cast, without holding a connection open for an hour.
--
-- A character profile is one model call, and a cast is a dozen of them. Doing
-- that inside the HTTP request that asked for it means a request minutes long,
-- and anything in front of the server gives up first — Cloudflare cuts a
-- request off at 100 seconds and answers with its own error page. The work
-- completed; the answer had nowhere to go.
--
-- So the request records what should be profiled and returns, and a worker
-- writes each profile as it finishes. Three things follow from that, all of
-- them improvements over the long request: progress can be watched rather than
-- waited on, a failure on the ninth character keeps the first eight, and
-- closing the tab no longer abandons the job.
--
-- One run per manuscript at a time. `wanted` is the queue as it was ordered and
-- `done` is what has been written, so the difference is what is left — which
-- survives a restart, unlike anything held in memory.

CREATE TABLE character_runs (
  work_id uuid PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  -- 'queued' | 'running' | 'idle' | 'failed'
  status text NOT NULL DEFAULT 'queued',

  wanted jsonb NOT NULL DEFAULT '[]'::jsonb,
  done jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Who is being profiled right now, for the progress line.
  current_subject text,
  -- Whose arc the axes are scored relative to. The reference document is firm
  -- that one chart is one perspective, so this is fixed for the whole run
  -- rather than re-decided per character.
  focal text,

  -- Of the digest the run was started against. A run judging a book that has
  -- since changed is finished rather than abandoned, but it is stamped with
  -- what it actually saw.
  digest_fingerprint text,

  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE character_runs ADD CONSTRAINT character_runs_status_known
  CHECK (status IN ('queued', 'running', 'idle', 'failed'));
