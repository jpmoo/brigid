-- Where things sit on the canvas.
--
-- The canvas is a third way of looking at the same manuscript, not a second
-- manuscript. The outline remains what decides order and nesting; a row here
-- only says where a block was put and how big it was drawn. Nothing structural
-- is stored, which is what lets the arrows be derived from the outline and
-- redraw the moment anything is reordered.
--
-- A block with no row has never been placed, and is laid out from its position
-- in the outline the first time the canvas is opened. Deleting the block takes
-- its placement with it; deleting the placement just means "put it back where
-- the outline suggests".

CREATE TABLE canvas_nodes (
  block_id uuid PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Canvas coordinates, relative to the parent region's origin. Relative
  -- rather than absolute so that moving a chapter carries its scenes with it
  -- without touching a row for each one.
  x double precision NOT NULL,
  y double precision NOT NULL,
  -- What the writer dragged it to. A region also grows on its own to contain
  -- its children, so this is a floor rather than the final size.
  w double precision NOT NULL,
  h double precision NOT NULL,

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX canvas_nodes_work_idx ON canvas_nodes (work_id);

-- A note on the canvas is a bookmark. Same row, same list in the book view,
-- stacked in the order it was made — which is what the writer asked for and
-- what the bookmark list already does.
--
-- What the canvas adds is where it hangs: which side of its node, and how far
-- along that side, so several notes on one edge keep their order and do not
-- land on top of each other. Null on every bookmark not made on the canvas.
ALTER TABLE bookmarks ADD COLUMN note_side text;
ALTER TABLE bookmarks ADD COLUMN note_offset double precision;

ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_note_side_known
  CHECK (note_side IS NULL OR note_side IN ('top', 'right', 'bottom', 'left'));
