-- Remove `rendersInDocument` from block formats.
--
-- It existed for notes: blocks that lived in the outline but never reached the
-- page. Bookmarks replaced notes, and with them gone a format that renders
-- nothing has no purpose — every block in the manuscript is in the manuscript.

UPDATE templates
SET format_settings = format_settings - 'rendersInDocument'
WHERE category = 'block-format'
  AND format_settings IS NOT NULL;
