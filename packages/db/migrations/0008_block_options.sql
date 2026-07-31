-- Per-block overrides.
--
-- These are decisions about one particular block rather than about the format
-- it renders through: whether the running word count starts again here, whether
-- the break attached to it counts toward that total, and whether the page
-- number restarts at it. Null throughout means "carry on as before", which is
-- what every existing block does.

ALTER TABLE blocks ADD COLUMN options jsonb;
