-- Remove the built-in Note format.
--
-- Notes were a way to keep something in the outline but out of the manuscript.
-- Bookmarks do that job better — a named place you can return to, rather than a
-- block pretending to be part of the book — so the format goes.
--
-- blocks.format_id is ON DELETE RESTRICT, so any block still using it is moved
-- to Regular text first. Those blocks start rendering and counting words, which
-- is the honest consequence of no longer having a format that hides them.

UPDATE blocks
SET format_id = (SELECT id FROM templates WHERE builtin_key = 'regular-text')
WHERE format_id IN (SELECT id FROM templates WHERE builtin_key = 'note');

DELETE FROM templates WHERE builtin_key = 'note';
