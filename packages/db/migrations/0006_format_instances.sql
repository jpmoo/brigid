-- Per-block format instances, mirroring break instances.
--
-- A block renders through the template its format_id names. Editing that
-- template changes every block using it, which is right for a house style and
-- wrong for one particular title page. Editing a single block's format copies
-- the body here, and from then on that block renders its own.
--
-- Null means "still following the template" — the default, and what every
-- existing block gets.

ALTER TABLE blocks ADD COLUMN format_body jsonb;
