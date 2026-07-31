import { useState } from "react";
import { Bookmark as BookmarkIcon, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { Bookmark } from "../api.js";

export const BOOKMARK_DRAG_TYPE = "application/x-brigid-bookmark";

/**
 * Bookmarks: named places to come back to.
 *
 * The source at the top is dragged onto a block in the manuscript, which is
 * where the bookmark lands. They point at blocks rather than at scroll
 * positions, so they survive the text around them being rewritten.
 */
export function BookmarkStrip({
  bookmarks,
  activeId,
  onGo,
  onRename,
  onDelete,
}: {
  bookmarks: Bookmark[];
  activeId: string | null;
  onGo: (bookmark: Bookmark) => void;
  onRename: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="bm-strip">
      <div className="bm-head">
        <span>Bookmarks</span>
        <span
          className={`bm-source${dragging ? " dragging" : ""}`}
          draggable
          title="Drag onto the manuscript to mark a place"
          onDragStart={(e) => {
            e.dataTransfer.setData(BOOKMARK_DRAG_TYPE, "new");
            e.dataTransfer.effectAllowed = "copy";
            setDragging(true);
          }}
          onDragEnd={() => setDragging(false)}
        >
          <GripVertical size={11} />
          <BookmarkIcon size={12} />
        </span>
      </div>

      {bookmarks.length === 0 ? (
        <p className="bm-empty">Drag the marker onto the manuscript to save a place.</p>
      ) : (
        <ul className="bm-list">
          {bookmarks.map((b) => (
            <li key={b.id} className={b.id === activeId ? "active" : ""}>
              <button type="button" className="bm-go" onClick={() => onGo(b)} title={b.name}>
                <BookmarkIcon size={11} />
                <span>{b.name}</span>
              </button>
              <button type="button" className="btn ghost" title="Rename" onClick={() => onRename(b)}>
                <Pencil size={11} />
              </button>
              <button type="button" className="btn ghost" title="Remove" onClick={() => onDelete(b)}>
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
