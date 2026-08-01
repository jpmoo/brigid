-- Line spacing measured the way a word processor measures it.
--
-- CSS line-height is a multiple of the font size; a word processor's "double"
-- is twice the font's own natural line, which for Courier and Times is about
-- 1.125 of the font size. So double is 2.25, not 2 — the seeded 2 was roughly
-- 11% tight against what a submission expects.

UPDATE templates
SET break_settings = jsonb_set(
      break_settings,
      '{typography,lineHeight}',
      '2.25'::jsonb
    )
WHERE category = 'break'
  AND break_settings -> 'typography' ->> 'lineHeight' = '2';

UPDATE templates
SET format_settings = jsonb_set(
      format_settings,
      '{typography,lineHeight}',
      '2.25'::jsonb
    )
WHERE category = 'block-format'
  AND format_settings -> 'typography' ->> 'lineHeight' = '2';

-- Typeset punctuation on by default: a manuscript wants real quotes and dashes,
-- and the setting is there to turn it off rather than to opt in.

UPDATE templates
SET format_settings = format_settings || '{"smartPunctuation": true}'::jsonb
WHERE category = 'block-format'
  AND format_settings IS NOT NULL
  AND NOT (format_settings ? 'smartPunctuation');

UPDATE templates
SET break_settings = break_settings || '{"smartPunctuation": true}'::jsonb
WHERE category = 'break'
  AND break_settings IS NOT NULL
  AND NOT (break_settings ? 'smartPunctuation');
