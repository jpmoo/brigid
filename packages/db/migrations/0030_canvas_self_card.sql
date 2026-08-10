-- Where a region's own prose sits inside it.
--
-- A block with children is drawn as a region, and its own paragraphs — the
-- opening of the chapter, before its first scene — get a card of their own
-- inside it. That card is part of the same block, not a separate one, so it
-- belongs in the same row rather than needing a table that pretends otherwise.
--
-- Relative to the region, like everything else on the canvas, so moving the
-- chapter carries its opening with it. Null means never moved: it is laid out
-- at the top of the region and stays there until someone drags it.

ALTER TABLE canvas_nodes ADD COLUMN self_x double precision;
ALTER TABLE canvas_nodes ADD COLUMN self_y double precision;
ALTER TABLE canvas_nodes ADD COLUMN self_w double precision;
ALTER TABLE canvas_nodes ADD COLUMN self_h double precision;
