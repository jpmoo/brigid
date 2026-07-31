-- Bookmarks: named places in a manuscript to come back to.
--
-- A bookmark points at a block rather than an offset, because a block survives
-- editing — an offset into prose does not. Deleting the block takes the
-- bookmark with it, which is right: the place no longer exists.

CREATE TABLE bookmarks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id    uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  block_id   uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_key   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bookmarks_work_sort_idx ON bookmarks (work_id, sort_key);
