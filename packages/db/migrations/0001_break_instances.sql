-- Per-block break instances.
--
-- A break normally renders from the template bound to the block's level, which
-- is what lets dragging a block to a different indentation change the break
-- before it. Editing one specific break detaches it: the body is copied onto the
-- block and from then on that block's break is its own, independent of both the
-- template and the level.
--
-- Null break_body means "still following the level" — the default, and what
-- every existing block gets.

ALTER TABLE blocks
  ADD COLUMN break_template_id uuid REFERENCES templates(id) ON DELETE SET NULL,
  ADD COLUMN break_body jsonb;

-- Both or neither: a body with no record of where it came from can't be shown
-- as "edited from Chapter break", and a source with no body is just noise.
ALTER TABLE blocks
  ADD CONSTRAINT blocks_break_instance_complete CHECK (
    (break_body IS NULL AND break_template_id IS NULL) OR
    (break_body IS NOT NULL AND break_template_id IS NOT NULL)
  );
