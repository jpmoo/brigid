import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid3x3, Minus, Plus } from "lucide-react";
import type { CanvasNode } from "@brigid/shared";
import type { Block } from "../api.js";

/**
 * The manuscript as nested regions on an endless surface.
 *
 * A third way of looking at the same book. The outline still decides what
 * contains what and what follows what — this only decides where things sit — so
 * the arrows are worked out from the outline every time it is drawn. Reorder a
 * chapter and they redraw with it, because there is no stored connection that
 * could disagree.
 *
 * Dragging moves and grows. It never re-parents: a scene dropped inside another
 * chapter's rectangle is a scene that has been moved on screen, not one that has
 * changed place in the book. Structure is the outline's business, and a canvas
 * that quietly rewrote it would make every accidental drag an edit.
 */

/** What a block looks like on the canvas before anyone has moved it. */
const DEFAULT_W = 260;
const DEFAULT_H = 120;
/** Room inside a region for its children, and between siblings. */
const PADDING = 28;
const GAP = 24;
/** The band along the top of a region that carries its own name. */
const HEADER = 34;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

const wordFmt = new Intl.NumberFormat();

export interface CanvasBlock {
  block: Block;
  /** Depth in the outline, so a region knows what it is called. */
  levelName: string;
  /** Words in this block and everything under it. */
  words: number;
  childCount: number;
  /** The break that falls before this block, if its level takes one. */
  breakName: string | null;
  /**
   * The length this section is aiming at, or null when it has none. Shaded the
   * same way the outline shades it — the shape of the book should read the same
   * whichever way it is being looked at.
   */
  goal: number | null;
}

/** A laid-out rectangle in canvas coordinates, absolute rather than relative. */
interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  parentId: string | null;
  item: CanvasBlock;
}

/**
 * Where everything goes.
 *
 * Saved placements win; anything never placed is laid out from its position in
 * the outline, which is the only sensible first guess — a book opened on the
 * canvas for the first time should look like the book, not like a heap.
 *
 * Regions are then grown to contain their children, which is why this runs
 * bottom-up: a chapter cannot know its size until its scenes have theirs.
 */
function layout(
  items: CanvasBlock[],
  saved: Map<string, CanvasNode>,
): { placed: Placed[]; unsaved: CanvasNode[] } {
  const byParent = new Map<string | null, CanvasBlock[]>();
  for (const item of items) {
    const key = item.block.parentId;
    byParent.set(key, [...(byParent.get(key) ?? []), item]);
  }

  const unsaved: CanvasNode[] = [];
  const placed: Placed[] = [];

  /** Lay out one generation, returning the space it needed. */
  const place = (
    parentId: string | null,
    originX: number,
    originY: number,
    depth: number,
  ): { w: number; h: number } => {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return { w: 0, h: 0 };

    let flowY = originY;
    let widest = 0;

    for (const item of children) {
      const own = saved.get(item.block.id);
      // Relative to the parent, so moving a region carries everything in it.
      const x = originX + (own?.x ?? 0);
      const y = own ? originY + own.y : flowY;

      // Children first: a region's size depends on what is inside it.
      const inside = place(item.block.id, x + PADDING, y + HEADER + PADDING / 2, depth + 1);

      const w = Math.max(own?.w ?? DEFAULT_W, inside.w + PADDING * 2);
      const h = Math.max(
        own?.h ?? DEFAULT_H,
        inside.h > 0 ? inside.h + HEADER + PADDING * 1.5 : 0,
      );

      if (!own) {
        // Written back so the arrangement is the writer's from now on, and does
        // not shuffle the next time a sibling is added.
        unsaved.push({ blockId: item.block.id, x: x - originX, y: y - originY, w, h });
      }

      placed.push({ id: item.block.id, x, y, w, h, depth, parentId, item });

      widest = Math.max(widest, x - originX + w);
      flowY = Math.max(flowY, y + h + GAP);
    }

    return { w: widest, h: flowY - originY };
  };

  place(null, 0, 0, 0);
  return { placed, unsaved };
}

/**
 * Which edges a connector should use, from where the two boxes actually are.
 *
 * The pair of sides that face each other: whichever axis separates them more
 * decides horizontal or vertical, and the sign decides which way round. Drag a
 * scene above the one before it and the arrow flips to leave from the top —
 * so a connector always takes the short way across the gap rather than looping
 * around a box to reach a side that stopped facing anything.
 */
function facingSides(from: Rect, to: Rect): { start: Point; end: Point; horizontal: boolean } {
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  const tx = to.x + to.w / 2;
  const ty = to.y + to.h / 2;

  const dx = tx - fx;
  const dy = ty - fy;

  // Compared against each box's own size, not in raw pixels: two wide regions
  // side by side are separated horizontally even when dx is smaller than dy.
  const spanX = Math.abs(dx) / Math.max(1, (from.w + to.w) / 2);
  const spanY = Math.abs(dy) / Math.max(1, (from.h + to.h) / 2);
  const horizontal = spanX >= spanY;

  if (horizontal) {
    const rightwards = dx >= 0;
    return {
      horizontal,
      start: { x: rightwards ? from.x + from.w : from.x, y: fy },
      end: { x: rightwards ? to.x : to.x + to.w, y: ty },
    };
  }

  const downwards = dy >= 0;
  return {
    horizontal,
    start: { x: fx, y: downwards ? from.y + from.h : from.y },
    end: { x: tx, y: downwards ? to.y : to.y + to.h },
  };
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a connector leaves one rectangle and arrives at the next. */
function arrow(from: Rect, to: Rect): string {
  const { start, end, horizontal } = facingSides(from, to);

  // A gentle S rather than a straight line: two boxes almost in line would
  // otherwise be joined by a stub too short to read as a direction.
  const bend = Math.max(
    24,
    (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) / 2,
  );
  const lead = horizontal
    ? { x: start.x + (end.x >= start.x ? bend : -bend), y: start.y }
    : { x: start.x, y: start.y + (end.y >= start.y ? bend : -bend) };
  const trail = horizontal
    ? { x: end.x - (end.x >= start.x ? bend : -bend), y: end.y }
    : { x: end.x, y: end.y - (end.y >= start.y ? bend : -bend) };

  return `M ${start.x} ${start.y} C ${lead.x} ${lead.y}, ${trail.x} ${trail.y}, ${end.x} ${end.y}`;
}

export function CanvasView({
  items,
  nodes,
  selectedId,
  onSelect,
  onOpen,
  onPlace,
}: {
  items: CanvasBlock[];
  nodes: CanvasNode[];
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  /** Double-click: the section opens for editing. */
  onOpen: (blockId: string) => void;
  onPlace: (nodes: CanvasNode[]) => void;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [grid, setGrid] = useState(true);
  /** What the percentage field says while it is being typed into. */
  const [zoomText, setZoomText] = useState("100");

  const saved = useMemo(() => new Map(nodes.map((n) => [n.blockId, n])), [nodes]);
  const { placed, unsaved } = useMemo(() => layout(items, saved), [items, saved]);

  // Anything never placed is written back once, so the first arrangement holds.
  useEffect(() => {
    if (unsaved.length > 0) onPlace(unsaved);
  }, [unsaved, onPlace]);

  useEffect(() => {
    setZoomText(String(Math.round(zoom * 100)));
  }, [zoom]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  /**
   * The arrows: every block to the one that follows it among its siblings.
   * Derived here rather than stored, so reordering the outline redraws them
   * with nothing to keep in step.
   */
  const links = useMemo(() => {
    const out: { key: string; d: string }[] = [];
    const siblings = new Map<string | null, Placed[]>();
    for (const p of placed) siblings.set(p.parentId, [...(siblings.get(p.parentId) ?? []), p]);

    for (const [, group] of siblings) {
      // In outline order, which is the order `items` arrives in.
      const order = group.slice().sort((a, b) => items.findIndex((i) => i.block.id === a.id) - items.findIndex((i) => i.block.id === b.id));
      for (let i = 0; i < order.length - 1; i += 1) {
        const from = order[i]!;
        const to = order[i + 1]!;
        out.push({ key: `${from.id}-${to.id}`, d: arrow(from, to) });
      }
    }
    return out;
  }, [placed, items]);

  const bounds = useMemo(() => {
    let w = 800;
    let h = 600;
    for (const p of placed) {
      w = Math.max(w, p.x + p.w + 200);
      h = Math.max(h, p.y + p.h + 200);
    }
    return { w, h };
  }, [placed]);

  /**
   * Panning and zooming.
   *
   * A drag on the surface pans, which is what an endless canvas is expected to
   * do and what a trackpad's two fingers send as a wheel event anyway. Ctrl or
   * the pinch gesture — which browsers deliver as a wheel with ctrlKey set —
   * zooms about the pointer rather than the centre, so the thing under the
   * cursor stays under it.
   */
  const panning = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        const box = surface.current?.getBoundingClientRect();
        if (!box) return;
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;

        setZoom((current) => {
          const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * (1 - event.deltaY / 400)));
          // Hold the point under the cursor still: its canvas coordinate must
          // read the same before and after.
          setPan((p) => ({
            x: px - ((px - p.x) / current) * next,
            y: py - ((py - p.y) / current) * next,
          }));
          return next;
        });
        return;
      }
      setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    },
    [],
  );

  const applyZoom = (value: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    const box = surface.current?.getBoundingClientRect();
    if (box) {
      // About the middle of what is on screen, since there is no pointer.
      const cx = box.width / 2;
      const cy = box.height / 2;
      setPan((p) => ({
        x: cx - ((cx - p.x) / zoom) * next,
        y: cy - ((cy - p.y) / zoom) * next,
      }));
    }
    setZoom(next);
  };

  /** Dragging a node. Position only — never a change of parent. */
  const dragging = useRef<{ id: string; x: number; y: number; startX: number; startY: number } | null>(
    null,
  );

  const onNodePointerDown = (event: React.PointerEvent, p: Placed) => {
    event.stopPropagation();
    onSelect(p.id);
    const own = saved.get(p.id);
    dragging.current = {
      id: p.id,
      x: event.clientX,
      y: event.clientY,
      startX: own?.x ?? 0,
      startY: own?.y ?? 0,
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onNodePointerMove = (event: React.PointerEvent) => {
    const held = dragging.current;
    if (!held) return;
    const p = byId.get(held.id);
    if (!p) return;
    onPlace([
      {
        blockId: held.id,
        x: held.startX + (event.clientX - held.x) / zoom,
        y: held.startY + (event.clientY - held.y) / zoom,
        w: p.w,
        h: p.h,
      },
    ]);
  };

  const endNodeDrag = () => {
    dragging.current = null;
  };

  return (
    <div className="canvas-shell">
      <div className="canvas-tools">
        <button
          className="btn ghost"
          type="button"
          title="Zoom out"
          onClick={() => applyZoom(zoom / 1.25)}
        >
          <Minus size={15} />
        </button>

        <label className="canvas-zoom">
          <input
            type="text"
            inputMode="numeric"
            value={zoomText}
            onChange={(e) => setZoomText(e.target.value)}
            onBlur={() => {
              const wanted = Number(zoomText.replace(/[^\d.]/g, ""));
              if (Number.isFinite(wanted) && wanted > 0) applyZoom(wanted / 100);
              else setZoomText(String(Math.round(zoom * 100)));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Zoom percentage"
          />
          <span>%</span>
        </label>

        <button
          className="btn ghost"
          type="button"
          title="Zoom in"
          onClick={() => applyZoom(zoom * 1.25)}
        >
          <Plus size={15} />
        </button>

        <button
          className={`btn ghost${grid ? " on" : ""}`}
          type="button"
          title={grid ? "Hide the grid" : "Show the grid"}
          aria-pressed={grid}
          onClick={() => setGrid(!grid)}
        >
          <Grid3x3 size={15} />
        </button>
      </div>

      <div
        className={`canvas-surface${grid ? " ruled" : ""}`}
        ref={surface}
        onWheel={onWheel}
        onPointerDown={(e) => {
          panning.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            onNodePointerMove(e);
            return;
          }
          const held = panning.current;
          if (!held) return;
          setPan({ x: held.panX + (e.clientX - held.x), y: held.panY + (e.clientY - held.y) });
        }}
        onPointerUp={() => {
          panning.current = null;
          endNodeDrag();
        }}
        // The dots are drawn in page pixels, so they have to move and scale
        // with the surface rather than sitting still behind it.
        style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
      >
        <div
          className="canvas-world"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: bounds.w,
            height: bounds.h,
          }}
        >
          <svg className="canvas-links" width={bounds.w} height={bounds.h} aria-hidden="true">
            <defs>
              <marker
                id="canvas-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {links.map((l) => (
              <path key={l.key} d={l.d} className="canvas-link" markerEnd="url(#canvas-arrow)" />
            ))}
          </svg>

          {placed.map((p) => (
            <div
              key={p.id}
              className={[
                "canvas-node",
                p.id === selectedId ? "selected" : "",
                p.item.childCount > 0 ? "region" : "",
                // Counted over the whole of it, as the outline counts it, so
                // the shading and the number agree.
                p.item.goal ? (p.item.words >= p.item.goal ? "met" : "short") : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
              onPointerDown={(e) => onNodePointerDown(e, p)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpen(p.id);
              }}
            >
              {/* The same things the outline card shows, in the same order —
                  it is the same block, and learning two vocabularies for one
                  object is a cost with nothing on the other side. */}
              <div className="cn-head">
                <span className="cn-label">{p.item.block.label || <em>Untitled</em>}</span>
                <span className="cn-level">{p.item.levelName}</span>
              </div>

              <div className="cn-meta">
                <span className="cn-words">{wordFmt.format(p.item.words)}</span>
                {p.item.childCount > 0 && p.item.block.wordCount !== p.item.words ? (
                  <span className="cn-own">{wordFmt.format(p.item.block.wordCount)} here</span>
                ) : null}
                {p.item.breakName ? <span className="cn-break">{p.item.breakName}</span> : null}
              </div>

              {p.item.block.contentText.trim() ? (
                <p className="cn-preview">{p.item.block.contentText.trim().slice(0, 220)}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
