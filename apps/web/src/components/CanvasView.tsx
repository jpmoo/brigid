import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Grid3x3, Minus, Plus, RotateCcw, StickyNote } from "lucide-react";
import { foldForSearch, foldForSearchMapped } from "@brigid/shared";
import type { CanvasNode } from "@brigid/shared";
import type { Block, Bookmark } from "../api.js";
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

/**
 * A card's preview with the searched term marked.
 *
 * Matched on the folded text — the same fold the search itself uses, so a
 * straight apostrophe typed into the box marks the typeset one on the card —
 * and mapped back, so what is wrapped is the real characters rather than the
 * folded stand-ins.
 */
function marked(text: string, query: string): ReactNode {
  const needle = foldForSearch(query.trim());
  if (needle.length === 0) return text;

  const folded = foldForSearchMapped(text);
  const out: ReactNode[] = [];
  let from = 0;
  let cut = 0;

  for (;;) {
    const at = folded.text.indexOf(needle, from);
    if (at === -1) break;
    const start = folded.at[at] ?? text.length;
    const end = folded.at[at + needle.length] ?? text.length;
    if (start > cut) out.push(text.slice(cut, start));
    out.push(
      <mark key={start} className="cn-hit">
        {text.slice(start, end)}
      </mark>,
    );
    cut = end;
    from = at + needle.length;
  }

  if (out.length === 0) return text;
  if (cut < text.length) out.push(text.slice(cut));
  return out;
}

export function CanvasView({
  items,
  nodes,
  selectedId,
  query,
  hits,
  focusId,
  bookmarks,
  onMoveNote,
  onSizeNote,
  onAddNote,
  onOpenNote,
  onSelect,
  onOpen,
  onPlace,
  onReset,
}: {
  items: CanvasBlock[];
  nodes: CanvasNode[];
  selectedId: string | null;
  /**
   * What is being searched for, and which cards hold it.
   *
   * A canvas has no reading order to scroll along, so searching it means
   * something different from searching the manuscript: the cards holding the
   * term light up where they are, and stepping through the results brings each
   * one to the middle in turn. The count is of cards, not occurrences.
   */
  query: string;
  hits: Set<string>;
  /** The card the writer has stepped to, brought into view. */
  focusId: string | null;
  /**
   * The manuscript's bookmarks, drawn here as notes.
   *
   * The same rows the book view lists — a note on the canvas is not a second
   * kind of thing. What the canvas adds is somewhere for it to sit and a line
   * back to the section it belongs to, so it can be put near what it is about
   * without being part of the sequence.
   */
  bookmarks: Bookmark[];
  onMoveNote: (bookmarkId: string, x: number, y: number) => void;
  /** A note resized by a corner: where it now sits, and how big. */
  onSizeNote: (bookmarkId: string, x: number, y: number, w: number, h: number) => void;
  /** A note dragged out from a card's side, dropped at an offset from it. */
  onAddNote: (blockId: string, x: number, y: number) => void;
  onOpenNote: (bookmarkId: string) => void;
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

  /** What a note is drawn as, before anyone has moved it. */
  const NOTE_W = 180;
  const NOTE_H = 120;
  const NOTE_MIN_W = 110;
  const NOTE_MIN_H = 70;

  /**
   * The notes, placed and tethered.
   *
   * A note belongs to a section but sits wherever the writer put it, so its
   * position is kept from that section's corner: dragging the section carries
   * its notes along without a write for each one, and reordering the outline
   * moves them with the card they are about.
   *
   * Unplaced ones are stacked off the card's right-hand edge, stepped down so
   * several on one section do not land on top of each other.
   */
  const notes = useMemo(() => {
    const perBlock = new Map<string, number>();
    const out: {
      note: Bookmark;
      x: number;
      y: number;
      w: number;
      h: number;
      /** The card it is about, for the line back to it. */
      host: Placed;
      unplaced: boolean;
    }[] = [];

    for (const note of bookmarks) {
      // A region's prose lives in the card standing for it, so a note on a
      // chapter hangs off its opening rather than off the whole rectangle.
      const host =
        byId.get(selfCardId(note.blockId)) ?? byId.get(note.blockId);
      if (!host) continue;

      const nth = perBlock.get(note.blockId) ?? 0;
      perBlock.set(note.blockId, nth + 1);
      const unplaced = note.noteX === null || note.noteY === null;

      out.push({
        note,
        x: host.x + (note.noteX ?? host.w + GAP),
        y: host.y + (note.noteY ?? nth * (NOTE_H + 16)),
        w: note.noteW ?? NOTE_W,
        h: note.noteH ?? NOTE_H,
        host,
        unplaced,
      });
    }
    return out;
  }, [bookmarks, byId]);

  /**
   * Where the notes went, written back once — the same bargain the blocks get.
   * A note laid out but never recorded would be laid out again next time, and
   * would move the moment another note was added to the same section.
   */
  const settleNotes = useRef(onMoveNote);
  settleNotes.current = onMoveNote;
  useEffect(() => {
    for (const n of notes) {
      if (!n.unplaced) continue;
      settleNotes.current(n.note.id, n.x - n.host.x, n.y - n.host.y);
    }
  }, [notes]);

  /** A dotted line from each note to the card it is about. */
  const tethers = useMemo(
    () =>
      notes.map((n) => ({
        key: n.note.id,
        // The same geometry the sequence arrows use: the two facing sides, and
        // the same bend across the gap. A note is joined to its section by a
        // different kind of line, not by a differently-shaped one — and it runs
        // from the note to the section, because that is the direction the
        // reader needs: this note is about that.
        d: arrow(
          { x: n.x, y: n.y, w: n.w, h: n.h },
          { x: n.host.x, y: n.host.y, w: n.host.w, h: n.host.h },
        ),
      })),
    [notes],
  );

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

  /**
   * Keep a pinch on the canvas rather than the page.
   *
   * A trackpad pinch arrives as a wheel event with `ctrlKey` set, and the
   * browser's own page zoom is the default action. React attaches its wheel
   * listener passively at the document root, where `preventDefault` is ignored
   * — so the handler below ran, the canvas zoomed, and the whole page zoomed
   * underneath it at the same time.
   *
   * Bound here instead, on the surface itself and explicitly not passive, which
   * is the only way to get the refusal to count. Safari sends `gesture*` events
   * for the same pinch and needs turning down separately.
   */
  useEffect(() => {
    const el = surface.current;
    if (!el) return;

    // Every wheel over the canvas, not only a pinch: a two-finger scroll is
    // this view's pan, so letting the default through as well would drag an
    // ancestor about underneath it.
    const stop = (event: Event) => event.preventDefault();

    el.addEventListener("wheel", stop, { passive: false });
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
      el.addEventListener(name, stop as EventListener, { passive: false });
    }
    return () => {
      el.removeEventListener("wheel", stop);
      for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
        el.removeEventListener(name, stop as EventListener);
      }
    };
  }, []);

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

  /**
   * Bring the stepped-to card into the middle.
   *
   * Panning rather than scrolling, since there is nothing to scroll: the pan
   * is chosen so the card's centre lands on the surface's centre. Zoom is left
   * where the writer put it unless it is too small to read the card at, in
   * which case it is lifted just far enough — stepping through results should
   * not quietly undo the zoom you chose.
   */
  const READABLE = 0.55;

  useEffect(() => {
    if (!focusId) return;
    const box = surface.current?.getBoundingClientRect();
    // A region's prose sits in the card standing for it, so that is what is
    // brought into view — centring the whole chapter would leave the writer
    // looking at a rectangle and hunting inside it for the word.
    const card =
      placed.find((p) => p.isSelfCard && p.parentId === focusId) ??
      placed.find((p) => !p.isSelfCard && p.id === focusId);
    if (!box || !card) return;

    const next = Math.max(zoom, READABLE);
    setZoom(next);
    setPan({
      x: box.width / 2 - (card.x + card.w / 2) * next,
      y: box.height / 2 - (card.y + card.h / 2) * next,
    });
    // Only when the writer steps to a different card. Following `placed` would
    // yank the view back to the result every time a card was dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

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
       * Not held in at all. The region is the bounding box of what it holds and
       * follows its contents in every direction, so an opening dragged past a
       * border takes the border with it — there is nothing to clamp it to.
       *
       * Skipped until the region has a row of its own, which the first
       * writeback gives it: there would be nothing to measure the offset
       * against, and guessing would jump the region across the canvas.
       */
      if (!own) return;
      onPlace([
        {
          ...own,
          selfX: held.startX + dx,
          selfY: held.startY + dy,
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

  /**
   * Resizing a note by a corner. The same arithmetic the cards use: a west or
   * north corner moves the note as it sizes it, so the far corner stays put.
   */
  const growingNote = useRef<{
    id: string;
    corner: "nw" | "ne" | "sw" | "se";
    x: number;
    y: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const onNoteGripDown = (
    event: React.PointerEvent,
    n: { note: Bookmark; x: number; y: number; w: number; h: number; host: Placed },
    corner: "nw" | "ne" | "sw" | "se",
  ) => {
    event.stopPropagation();
    growingNote.current = {
      id: n.note.id,
      corner,
      x: event.clientX,
      y: event.clientY,
      startX: n.x - n.host.x,
      startY: n.y - n.host.y,
      startW: n.w,
      startH: n.h,
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onNoteGripMove = (event: React.PointerEvent) => {
    const held = growingNote.current;
    if (!held) return;
    const dx = (event.clientX - held.x) / zoom;
    const dy = (event.clientY - held.y) / zoom;
    const west = held.corner === "nw" || held.corner === "sw";
    const north = held.corner === "nw" || held.corner === "ne";

    const w = Math.max(NOTE_MIN_W, held.startW + (west ? -dx : dx));
    const h = Math.max(NOTE_MIN_H, held.startH + (north ? -dy : dy));
    onSizeNote(
      held.id,
      held.startX + (west ? held.startW - w : 0),
      held.startY + (north ? held.startH - h : 0),
      w,
      h,
    );
  };

  /**
   * Hanging a new note off a card.
   *
   * Dragged out from a tab on one of the four sides, and dropped wherever it
   * lands — the side says which way it was pulled, not where the note must
   * live. A ghost follows the pointer so the drag reads as making something
   * rather than as a click that will produce a note somewhere off screen.
   */
  const hanging = useRef<{ blockId: string; host: Placed } | null>(null);
  const [hangingAt, setHangingAt] = useState<{ x: number; y: number } | null>(null);

  const canvasPoint = (event: React.PointerEvent): { x: number; y: number } | null => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: (event.clientX - box.left - pan.x) / zoom,
      y: (event.clientY - box.top - pan.y) / zoom,
    };
  };

  const onHangPointerDown = (event: React.PointerEvent, p: Placed) => {
    event.stopPropagation();
    hanging.current = { blockId: p.isSelfCard ? (p.parentId ?? p.id) : p.id, host: p };
    setHangingAt(canvasPoint(event));
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onHangPointerMove = (event: React.PointerEvent) => {
    if (!hanging.current) return;
    setHangingAt(canvasPoint(event));
  };

  const onHangPointerUp = (event: React.PointerEvent) => {
    const held = hanging.current;
    const at = canvasPoint(event);
    hanging.current = null;
    setHangingAt(null);
    if (!held || !at) return;
    // Dropped where the pointer let go, kept from its card's corner — so the
    // note travels with the section rather than with the canvas.
    onAddNote(held.blockId, at.x - held.host.x, at.y - held.host.y);
  };

  /**
   * Resizing a card by a corner.
   *
   * Only cards. A region is the size of what it holds and has no size of its
   * own to set — dragging its corner would be a request the next redraw would
   * quietly refuse.
   *
   * Dragging a west or north corner moves the card as well as sizing it, so the
   * opposite corner stays put: a card grabbed by its top-left should grow up
   * and to the left, not slide down.
   */
  const resizing = useRef<{
    id: string;
    blockId: string;
    self: boolean;
    corner: "nw" | "ne" | "sw" | "se";
    x: number;
    y: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const MIN_W = 120;
  const MIN_H = 70;

  const onGripPointerDown = (
    event: React.PointerEvent,
    p: Placed,
    corner: "nw" | "ne" | "sw" | "se",
  ) => {
    event.stopPropagation();
    const blockId = p.isSelfCard ? (p.parentId ?? p.id) : p.id;
    const own = saved.get(blockId);
    if (!own) return;
    resizing.current = {
      id: p.id,
      blockId,
      self: p.isSelfCard,
      corner,
      x: event.clientX,
      y: event.clientY,
      startX: (p.isSelfCard ? own.selfX : own.x) ?? 0,
      startY: (p.isSelfCard ? own.selfY : own.y) ?? 0,
      startW: p.w,
      startH: p.h,
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onGripPointerMove = (event: React.PointerEvent) => {
    const held = resizing.current;
    if (!held) return;
    const own = saved.get(held.blockId);
    if (!own) return;

    const dx = (event.clientX - held.x) / zoom;
    const dy = (event.clientY - held.y) / zoom;
    const west = held.corner === "nw" || held.corner === "sw";
    const north = held.corner === "nw" || held.corner === "ne";

    // A west or north drag takes width off the near edge, so the far edge is
    // what stays still; clamped first, or the corner would keep travelling
    // after the card had stopped shrinking.
    const w = Math.max(MIN_W, held.startW + (west ? -dx : dx));
    const h = Math.max(MIN_H, held.startH + (north ? -dy : dy));
    const x = held.startX + (west ? held.startW - w : 0);
    const y = held.startY + (north ? held.startH - h : 0);

    onPlace([
      held.self
        ? { ...own, selfX: x, selfY: y, selfW: w, selfH: h }
        : { ...own, x, y, w, h },
    ]);
  };

  /**
   * Dragging a note. Never re-tethers: a note dropped over another section is a
   * note that has been moved, not one that now belongs to that section. Which
   * section a note is about is the bookmark's business, the same way which
   * chapter a scene is in stays the outline's.
   */
  const draggingNote = useRef<{ id: string; x: number; y: number; startX: number; startY: number } | null>(
    null,
  );

  const onNotePointerDown = (event: React.PointerEvent, id: string, offX: number, offY: number) => {
    event.stopPropagation();
    draggingNote.current = { id, x: event.clientX, y: event.clientY, startX: offX, startY: offY };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onNotePointerMove = (event: React.PointerEvent) => {
    const held = draggingNote.current;
    if (!held) return;
    onMoveNote(
      held.id,
      held.startX + (event.clientX - held.x) / zoom,
      held.startY + (event.clientY - held.y) / zoom,
    );
  };

  const endNodeDrag = () => {
    dragging.current = null;
    draggingNote.current = null;
    resizing.current = null;
    growingNote.current = null;
    hanging.current = null;
    setHangingAt(null);
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
          if (resizing.current) {
            onGripPointerMove(e);
            return;
          }
          if (growingNote.current) {
            onNoteGripMove(e);
            return;
          }
          if (hanging.current) {
            onHangPointerMove(e);
            return;
          }
          if (dragging.current) {
            onNodePointerMove(e);
            return;
          }
          if (draggingNote.current) {
            onNotePointerMove(e);
            return;
          }
          const held = panning.current;
          if (!held) return;
          setPan({ x: held.panX + (e.clientX - held.x), y: held.panY + (e.clientY - held.y) });
        }}
        onPointerUp={(e) => {
          if (hanging.current) onHangPointerUp(e);
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
            /**
             * Whose prose this card shows, for lighting it up on a search.
             *
             * A region is a container — its own prose lives in the card
             * standing for it — so a region never lights. Lighting a
             * chapter-sized rectangle would say the term is somewhere in the
             * chapter, which is not what was found.
             */
            const holds = isRegion ? null : (p.isSelfCard ? p.parentId : p.id);
            return (
            <div
              key={p.id}
              className={[
                "canvas-node",
                /**
                 * A region's own block is shown by the card standing for it, so
                 * that is what lights — selecting a chapter's opening should
                 * mark the opening, not draw a border round the whole chapter.
                 */
                holds && holds === selectedId ? "selected" : "",
                isRegion ? "region" : "",
                p.isSelfCard ? "self" : "",
                holds && hits.has(holds) ? "hit" : "",
                holds && holds === focusId ? "hit-active" : "",
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

              {/* Grips and tabs on cards only. A region is the size of what it
                  holds, so there is nothing about it to set by hand, and its
                  notes hang off the card standing for its prose. */}
              {!isRegion ? (
                <>
                  {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                    <span
                      key={corner}
                      className={`cn-grip ${corner}`}
                      onPointerDown={(e) => onGripPointerDown(e, p, corner)}
                    />
                  ))}
                  {(["top", "right", "bottom", "left"] as const).map((side) => (
                    <span
                      key={side}
                      className={`cn-tab ${side}`}
                      title="Drag out to add a note"
                      onPointerDown={(e) => onHangPointerDown(e, p)}
                    >
                      <StickyNote size={12} />
                    </span>
                  ))}
                </>
              ) : null}

              {/* A region is a container: its own prose lives in the card
                  standing for it, first among its children, so nothing is
                  drawn here for anything to overlap. */}
              {!isRegion && p.item.block.contentText.trim() ? (
                <p className="cn-preview">
                  {marked(p.item.block.contentText.trim().slice(0, 220), query)}
                </p>
              ) : null}
            </div>
                  );
                })}
            </Fragment>
          ))}

          {/* Notes last, over everything. A note is stuck to the canvas rather
              than set into it, and it is small enough that anything drawn on
              top of it would hide it entirely. */}
          <svg className="canvas-links" width={bounds.w} height={bounds.h}>
            <defs>
              <marker
                id="canvas-tether-arrow"
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
            {tethers.map((tether) => (
              <path
                key={tether.key}
                d={tether.d}
                className="canvas-tether"
                markerEnd="url(#canvas-tether-arrow)"
              />
            ))}
          </svg>

          {hangingAt ? (
            <div
              className="canvas-note ghost"
              style={{ left: hangingAt.x, top: hangingAt.y, width: NOTE_W, height: NOTE_H }}
            >
              <span className="cnote-paper">
                <span className="cnote-name">New note</span>
              </span>
            </div>
          ) : null}

          {notes.map((n) => (
            <div
              key={n.note.id}
              className={`canvas-note${n.note.id === selectedId ? " selected" : ""}`}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              title={n.note.description ?? undefined}
              onPointerDown={(e) =>
                onNotePointerDown(e, n.note.id, n.x - n.host.x, n.y - n.host.y)
              }
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenNote(n.note.id);
              }}
            >
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <span
                  key={corner}
                  className={`cn-grip ${corner}`}
                  onPointerDown={(e) => onNoteGripDown(e, n, corner)}
                />
              ))}
              {/* The paper is a layer of its own because its turned corner is
                  cut with a clip-path, and a clip-path takes the element's
                  children with it — the corner ate the grip that sat in it, so
                  dragging there moved the note instead of sizing it. */}
              <span className="cnote-paper">
                <span className="cnote-name">{n.note.name}</span>
                {n.note.description ? (
                  <span className="cnote-body">{n.note.description}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
