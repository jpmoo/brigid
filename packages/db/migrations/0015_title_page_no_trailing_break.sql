-- A title page shouldn't end with a page break.
--
-- The break that opens the first chapter already turns the page, so a break at
-- the foot of the title page turns it twice and the second one arrives blank.
-- Compile trims breaks at the edges of a section, but the manuscript on screen
-- showed the blank page, and so did anything reading the template directly.
--
-- Applies to the seeded title page, to the per-work title pages the importer
-- creates, and to any copy a block has taken for itself. Only a trailing break
-- is removed: one in the middle of a title page was put there on purpose.

UPDATE templates
SET body = jsonb_set(
      body,
      '{nodes}',
      (SELECT COALESCE(jsonb_agg(node ORDER BY i), '[]'::jsonb)
       FROM jsonb_array_elements(body -> 'nodes') WITH ORDINALITY AS t(node, i)
       WHERE i < jsonb_array_length(body -> 'nodes')
          OR node ->> 'type' <> 'pageBreak')
    )
WHERE category = 'block-format'
  AND (format_settings ->> 'structural')::boolean IS FALSE
  AND jsonb_array_length(body -> 'nodes') > 0
  AND (body -> 'nodes' -> (jsonb_array_length(body -> 'nodes') - 1) ->> 'type') = 'pageBreak';

UPDATE blocks
SET format_body = jsonb_set(
      format_body,
      '{nodes}',
      (SELECT COALESCE(jsonb_agg(node ORDER BY i), '[]'::jsonb)
       FROM jsonb_array_elements(format_body -> 'nodes') WITH ORDINALITY AS t(node, i)
       WHERE i < jsonb_array_length(format_body -> 'nodes')
          OR node ->> 'type' <> 'pageBreak')
    )
WHERE format_body IS NOT NULL
  AND jsonb_array_length(format_body -> 'nodes') > 0
  AND (format_body -> 'nodes' -> (jsonb_array_length(format_body -> 'nodes') - 1) ->> 'type') = 'pageBreak'
  AND format_id IN (
    SELECT id FROM templates
    WHERE category = 'block-format' AND (format_settings ->> 'structural')::boolean IS FALSE
  );
