-- Whether the writer says the manuscript is done.
--
-- The story-shape judge was told every manuscript was probably unfinished, and
-- believed it: a finished book with a quiet ending was reported as a draft
-- breaking off. Only the writer knows, so the writer says. False for every
-- existing work, which keeps the old caution until someone says otherwise.

ALTER TABLE works ADD COLUMN finished boolean NOT NULL DEFAULT false;
