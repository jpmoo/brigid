import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid3x3, Minus, Plus, RotateCcw } from "lucide-react";
import type { CanvasNode } from "@brigid/shared";
import type { Block } from "../api.js";
import { HoldToConfirm } from "./HoldToConfirm.js";
import { GAP, layout, selfCardId } from "./canvas-layout.js";
import type { CanvasBlock, Placed } from "./canvas-layout.js";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

const wordFmt = new Intl.NumberFormat();

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
  onReset,
}: {
  items: CanvasBlock[];
  nodes: CanvasNode[];
  selectedId: string | null;
  onSelect: (blockId: string) => void;
  /** Double-click: the section opens for editing. */
  onOpen: (blockId: string) => void;
  onPlace: (nodes: CanvasNode[]) => void;
  /** Throw the arrangement away and let it be drawn again. */
  onReset: () => void;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [grid, setGrid] = useState(true);
  const [resetting, setResetting] = useState(false);
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
    const out: { key: string; d: string; depth: number }[] = [];
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
        // Kept with the depth they join, so each set can be drawn after the
        // region it lives inside and before the cards it joins.
        out.push({ key: `${from.id}-${to.id}`, d: arrow(from, to), depth: from.depth });
      }
    }
    return out;
  }, [placed, items]);

  /** Every depth in play, outermost first — the order things are painted in. */
  const depths = useMemo(
    () => [...new Set(placed.map((p) => p.depth))].sort((a, b) => a - b),
    [placed],
  );

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
          const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * (1 - event.deltaY / 160)));
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
          onClick={() => applyZoom(zoom / 1.4)}
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
          onClick={() => applyZoom(zoom * 1.4)}
        >
          <Plus size={15} />
        </button>

        <button
          className="btn ghost"
          type="button"
          title="Lay the canvas out again"
          aria-label="Lay the canvas out again"
          onClick={() => setResetting(true)}
        >
          <RotateCcw size={15} />
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

      {resetting ? (
        <div className="modal-backdrop" onClick={() => setResetting(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title">Lay the canvas out again?</h2>
            <p className="card-subtitle">
              Every position and size you have set here is forgotten, and the canvas is
              drawn from the outline as it would be the first time you opened it.
            </p>
            <p className="tpl-note">
              Your manuscript is not touched. The arrangement is the only thing this view
              stores, so this undoes nothing but the arranging.
            </p>
            <div className="modal-actions">
              <button
                className="btn secondary"
                type="button"
                onClick={() => setResetting(false)}
              >
                Keep this arrangement
              </button>
              {/* Held rather than clicked, as everywhere else that discards
                  work. An arrangement is quiet, patient work, and it should
                  not go to a button pressed on the way past. */}
              <HoldToConfirm
                seconds={3}
                label="Hold to lay it out again"
                holdingLabel="Keep holding…"
                onConfirm={() => {
                  onReset();
                  setResetting(false);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

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
        style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${36 * zoom}px ${36 * zoom}px` }}
      >
        <div
          className="canvas-world"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: bounds.w,
            height: bounds.h,
          }}
        >
          {/* Drawn depth by depth: the arrows for a generation, then the cards
              of that generation on top of them.

              A single layer underneath everything looked right for chapters and
              lost every arrow inside a region — the region is painted after
              them, and painted over them. Interleaving puts each set above its
              own container and below the cards it joins. */}
          {depths.map((depth) => (
            <Fragment key={depth}>
              <svg
                className="canvas-links"
                width={bounds.w}
                height={bounds.h}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={`canvas-arrow-${depth}`}
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
                {links
                  .filter((l) => l.depth === depth)
                  .map((l) => (
                    <path
                      key={l.key}
                      d={l.d}
                      className="canvas-link"
                      markerEnd={`url(#canvas-arrow-${depth})`}
                    />
                  ))}
              </svg>

              {placed
                .filter((p) => p.depth === depth)
                .map((p) => {
            const isRegion = !p.isSelfCard && p.item.childCount > 0;
            return (
            <div
              key={p.id}
              className={[
                "canvas-node",
                p.id === selectedId ? "selected" : "",
                isRegion ? "region" : "",
                p.isSelfCard ? "self" : "",
                /**
                 * Shaded on the region, and only there.
                 *
                 * The goal belongs to the level — the chapter — and the region
                 * is the chapter. The card holding its opening is part of the
                 * same thing, so shading it too would say the same thing twice
                 * and imply the opening had a target of its own. A section is
                 * shaded only when its own level carries a goal.
                 */
                !p.isSelfCard && p.item.goal
                  ? p.item.words >= p.item.goal
                    ? "met"
                    : "short"
                  : "",
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
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
