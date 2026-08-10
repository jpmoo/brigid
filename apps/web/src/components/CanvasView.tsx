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
  /** A region's own prose, drawn as the first card inside it. */
  isSelfCard: boolean;
}

/**
 * How wide a region tries to get before wrapping its children onto a new row.
 * Chosen so a chapter of a few scenes lands roughly square, which is the shape
 * that wastes least on an endless surface and reads best at a distance.
 */
const ROW_WIDTH = 900;

/**
 * A card standing for a block's own prose, inside the region it heads.
 *
 * A block that contains others is drawn as a region: a container named by the
 * break that starts it. But it usually has prose of its own — the opening of
 * the chapter, before its first scene — and that prose has nowhere to go on a
 * container. So it is given an ordinary card, first among the region's
 * children, and the region keeps nothing but a title. Nothing overlaps, and the
 * sequence arrow runs through it into the scenes that follow.
 *
 * It is not separately placeable: it belongs to the region and moves with it,
 * which is also why it needs no row of its own in the database.
 */
function selfCardId(blockId: string): string {
  return `${blockId}::self`;
}

/**
 * Where everything goes.
 *
 * Saved placements win; anything never placed is laid out from its position in
 * the outline, wrapped into rows rather than run down a column — a book is
 * wider than it is tall on a canvas, and a single column of forty chapters is
 * unreadable at any zoom that shows more than three.
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

  const place = (
    parentId: string | null,
    originX: number,
    originY: number,
    depth: number,
  ): { w: number; h: number } => {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return { w: 0, h: 0 };

    // Where the next unplaced thing goes, wrapping when the row is full.
    let rowX = originX;
    let rowY = originY;
    let rowH = 0;
    let widest = 0;
    let deepest = originY;

    const advance = (w: number, h: number): { x: number; y: number } => {
      if (rowX > originX && rowX + w > originX + ROW_WIDTH) {
        rowX = originX;
        rowY += rowH + GAP;
        rowH = 0;
      }
      const at = { x: rowX, y: rowY };
      rowX += w + GAP;
      rowH = Math.max(rowH, h);
      return at;
    };

    for (const item of children) {
      const isRegion = item.childCount > 0;
      const own = saved.get(item.block.id);

      /**
       * A region's size is decided by what is inside it, so its children are
       * laid out first — against a provisional origin, then moved once the
       * region's own corner is known. Cheaper than laying out twice.
       */
      const guess = own
        ? { x: originX + own.x, y: originY + own.y }
        : advance(DEFAULT_W, DEFAULT_H);

      let inside = { w: 0, h: 0 };
      if (isRegion) {
        /**
         * The block's own prose, inside the region it heads. A block only has
         * children because a break set it above what follows, so it always has
         * something of its own to show — at the very least a title — and the
         * card is always drawn.
         *
         * Where it sits is the writer's, once they have moved it. Until then it
         * goes at the top of the region, which is where the chapter's opening
         * belongs.
         */
        const selfW = own?.selfW ?? DEFAULT_W;
        const selfH = own?.selfH ?? DEFAULT_H;
        const inner = { x: guess.x + PADDING, y: guess.y + HEADER + PADDING / 2 };
        const selfAt = {
          x: inner.x + (own?.selfX ?? 0),
          y: inner.y + (own?.selfY ?? 0),
        };

        placed.push({
          id: selfCardId(item.block.id),
          x: selfAt.x,
          y: selfAt.y,
          w: selfW,
          h: selfH,
          depth: depth + 1,
          parentId: item.block.id,
          item,
          isSelfCard: true,
        });

        // The rest flow below wherever the opening ended up, so a moved card
        // pushes its scenes rather than sitting on them.
        inside = place(item.block.id, inner.x, selfAt.y + selfH + GAP, depth + 1);
        inside = {
          w: Math.max(inside.w, selfAt.x - inner.x + selfW),
          h: Math.max(inside.h, selfAt.y - inner.y + selfH) + GAP,
        };
      }

      const w = Math.max(own?.w ?? DEFAULT_W, isRegion ? inside.w + PADDING * 2 : 0);
      const h = Math.max(
        own?.h ?? DEFAULT_H,
        isRegion ? inside.h + HEADER + PADDING * 1.5 : 0,
      );

      if (!own) {
        unsaved.push({ blockId: item.block.id, x: guess.x - originX, y: guess.y - originY, w, h });
        // The row only knew the guessed size; a grown region needs more room.
        rowX = Math.max(rowX, guess.x + w + GAP);
        rowH = Math.max(rowH, h);
      }

      placed.push({
        id: item.block.id,
        x: guess.x,
        y: guess.y,
        w,
        h,
        depth,
        parentId,
        item,
        isSelfCard: false,
      });

      widest = Math.max(widest, guess.x - originX + w);
      deepest = Math.max(deepest, guess.y + h);
    }

    return { w: widest, h: deepest - originY };
  };

  place(null, 0, 0, 0);

  /**
   * Outermost first.
   *
   * Laying out is depth-last — a region cannot know its size until its children
   * have theirs — so `placed` comes back with children before their parents.
   * Painted in that order the region is drawn on top of everything it contains,
   * which is precisely the report that chapters had nothing in them.
   */
  placed.sort((a, b) => a.depth - b.depth);
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
      /**
       * In outline order, with a region's own prose first among its children —
       * the chapter's opening comes before its first scene, so the sequence
       * runs through the card standing for it.
       */
      const rank = (p: Placed) =>
        p.isSelfCard ? -1 : items.findIndex((i) => i.block.id === p.id);
      const order = group.slice().sort((a, b) => rank(a) - rank(b));
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
  const dragging = useRef<{
    id: string;
    /** The block whose row this drag writes to — a self card writes its region's. */
    blockId: string;
    self: boolean;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);

  const onNodePointerDown = (event: React.PointerEvent, p: Placed) => {
    event.stopPropagation();
    const blockId = p.isSelfCard ? (p.parentId ?? p.id) : p.id;
    onSelect(blockId);
    const own = saved.get(blockId);
    dragging.current = {
      id: p.id,
      blockId,
      self: p.isSelfCard,
      x: event.clientX,
      y: event.clientY,
      startX: (p.isSelfCard ? own?.selfX : own?.x) ?? 0,
      startY: (p.isSelfCard ? own?.selfY : own?.y) ?? 0,
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onNodePointerMove = (event: React.PointerEvent) => {
    const held = dragging.current;
    if (!held) return;
    const p = byId.get(held.id);
    const region = byId.get(held.blockId);
    if (!p || !region) return;

    const dx = (event.clientX - held.x) / zoom;
    const dy = (event.clientY - held.y) / zoom;
    const own = saved.get(held.blockId);

    if (held.self) {
      /**
       * Inside its region, never out of it. Negative would put the opening
       * above the region's own title bar; the region grows to the right and
       * downwards on its own, so there is no far edge to hold it against.
       */
      onPlace([
        {
          blockId: held.blockId,
          x: own?.x ?? region.x,
          y: own?.y ?? region.y,
          w: own?.w ?? region.w,
          h: own?.h ?? region.h,
          selfX: Math.max(0, held.startX + dx),
          selfY: Math.max(0, held.startY + dy),
          selfW: p.w,
          selfH: p.h,
        },
      ]);
      return;
    }

    onPlace([
      {
        blockId: held.blockId,
        x: held.startX + dx,
        y: held.startY + dy,
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

          {placed.map((p) => {
            const isRegion = !p.isSelfCard && p.item.childCount > 0;
            return (
            <div
              key={p.id}
              className={[
                "canvas-node",
                p.id === selectedId ? "selected" : "",
                isRegion ? "region" : "",
                p.isSelfCard ? "self" : "",
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
                // The self card stands for its region's block, so it opens it.
                onOpen(p.isSelfCard ? p.parentId ?? p.id : p.id);
              }}
            >
              {/* The same things the outline card shows, in the same order —
                  it is the same block, and learning two vocabularies for one
                  object is a cost with nothing on the other side. */}
              <div className="cn-head">
                <span className="cn-label">{p.item.block.label || <em>Untitled</em>}</span>
                <span className="cn-level">
                  {/* The region is named by the break that starts it; the card
                      inside it is that block's own prose. */}
                  {p.isSelfCard ? "opening" : (p.item.breakName ?? p.item.levelName)}
                </span>
              </div>

              <div className="cn-meta">
                <span className="cn-words">
                  {wordFmt.format(p.isSelfCard ? p.item.block.wordCount : p.item.words)}
                </span>
                {p.item.childCount > 0 && p.item.block.wordCount !== p.item.words ? (
                  <span className="cn-own">{wordFmt.format(p.item.block.wordCount)} here</span>
                ) : null}
                {p.item.breakName ? <span className="cn-break">{p.item.breakName}</span> : null}
              </div>

              {/* A region is a container: its own prose lives in the card
                  standing for it, first among its children, so nothing is
                  drawn here for anything to overlap. */}
              {!isRegion && p.item.block.contentText.trim() ? (
                <p className="cn-preview">{p.item.block.contentText.trim().slice(0, 220)}</p>
              ) : null}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
