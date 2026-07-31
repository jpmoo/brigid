-- Whether the paragraph opening after a break is indented.
--
-- Absent already behaved as false in the renderer, so this changes nothing on
-- an existing manuscript; it makes the stored settings self-describing so the
-- template editor can show a real checkbox rather than an indeterminate one.

UPDATE templates
SET break_settings = break_settings || '{"indentFirstParagraph": false}'::jsonb
WHERE category = 'break'
  AND break_settings IS NOT NULL
  AND NOT (break_settings ? 'indentFirstParagraph');
