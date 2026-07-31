-- Per-block typography override.
--
-- A format like Regular text has no layout to detach — its body is just the
-- content slot — so "edit this block's format" means its type, not its
-- arrangement. That lives here rather than in format_body, because a body of
-- one content node has nothing to say about fonts.
--
-- Null means the block still takes its type from its format template.

ALTER TABLE blocks ADD COLUMN format_typography jsonb;
