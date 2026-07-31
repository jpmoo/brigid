-- Manuscript typography for the built-in formats.
--
-- These are the values submission guidelines conventionally ask for, but none of
-- them are baked into the renderer — they live in the template because they are
-- the writer's to change. Reading mode ignores them entirely and uses the app's
-- own typography.

UPDATE templates
SET format_settings = format_settings || '{
      "typography": {
        "fontFamily": "\"Courier New\", Courier, monospace",
        "fontSizePt": 12,
        "lineHeight": 2,
        "align": "left",
        "firstLineIndentIn": 0.5
      }
    }'::jsonb
WHERE builtin_key IN ('regular-text', 'note')
  AND format_settings IS NOT NULL
  AND NOT (format_settings ? 'typography');

UPDATE templates
SET format_settings = format_settings || '{
      "typography": {
        "fontFamily": "\"Courier New\", Courier, monospace",
        "fontSizePt": 12,
        "lineHeight": 2,
        "align": "center",
        "firstLineIndentIn": 0
      }
    }'::jsonb
WHERE builtin_key = 'title-page'
  AND format_settings IS NOT NULL
  AND NOT (format_settings ? 'typography');

UPDATE templates
SET break_settings = break_settings || '{
      "typography": {
        "fontFamily": "\"Courier New\", Courier, monospace",
        "fontSizePt": 12,
        "lineHeight": 2,
        "align": "center"
      }
    }'::jsonb
WHERE category = 'break'
  AND break_settings IS NOT NULL
  AND NOT (break_settings ? 'typography');
