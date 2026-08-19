-- What was written, and when.
--
-- Nothing recorded this. Every block carries an updated_at, but it is
-- overwritten on each save, so it says when a section was last touched and
-- nothing about the shape of the work: not what was added, not what came out,
-- and not the difference between an hour of drafting and an hour of cutting. A
-- writer's own history of their book was simply not being kept.
--
-- Which means the past cannot be recovered. This starts from the day it is
-- installed, and there is no honest way to reconstruct what came before — the
-- nightly backups hold ten whole-database snapshots, which would give at best
-- ten daily totals and never the two directions separately.
--
-- One row per minute in which anything happened, per manuscript. Saves are
-- frequent and a row each would be a table of noise; a minute is fine enough
-- for a writing sitting, which is the shortest thing anyone asks about, and
-- coarse enough that a year of hard work is a few tens of thousands of rows.
-- Days are rolled up from these on the way out rather than stored twice.
--
-- Added and deleted are kept apart on purpose. Their sum is the only thing the
-- word count could ever have told you, and it is the least interesting number:
-- a day of writing four hundred words and cutting three hundred and ninety is
-- not a day of writing ten.
CREATE TABLE writing_activity (
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  minute timestamptz NOT NULL,
  added integer NOT NULL DEFAULT 0,
  deleted integer NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, minute)
);

CREATE INDEX writing_activity_when ON writing_activity (work_id, minute DESC);

COMMENT ON TABLE writing_activity IS
  'Words added and removed, bucketed by the minute they happened in. Starts '
  'when this table was created; earlier work cannot be reconstructed.';

COMMENT ON COLUMN writing_activity.added IS
  'Words present after a save that were not present before it.';

COMMENT ON COLUMN writing_activity.deleted IS
  'Words present before a save that were not present after it.';
