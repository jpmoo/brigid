import type { CanvasNode } from "@brigid/shared";
import type { Block } from "../api.js";

/**
 * Where everything sits on the canvas — arithmetic only, no React.
 *
 * Kept apart from the view because it is the part that can be wrong in ways you
 * cannot see: a layout that drifts a little on each draw looks fine once and
 * wrong on the fourth. Separated, it can be run twice over its own output and
 * checked, which is what `canvas-layout.test.ts` does.
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
export function facingSides(from: Rect, to: Rect): { start: Point; end: Point; horizontal: boolean } {
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

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a connector leaves one rectangle and arrives at the next. */
/**
 * How far the arrival leans from square-on towards the line's own direction.
 *
 * Zero arrives perpendicular to the face, one aims straight from one box at the
 * other. Halfway keeps the sense of leaving and entering by a particular side
 * while letting the last stretch lie along the way the connector is actually
 * travelling.
 */
const TILT = 0.5;

/**
 * The path from one box to the next.
 *
 * A gentle S rather than a straight line: two boxes almost in line would
 * otherwise be joined by a stub too short to read as a direction.
 *
 * The control points lean. Held square to the face — which is what they were —
 * the curve's tangent where it lands is exactly horizontal or vertical, and an
 * arrowhead orients itself to that tangent. So a connector crossing at an angle
 * ended in an arrowhead pointing flatly sideways, with a visible kink in the
 * last few pixels where the curve straightened up to meet it. Leaning the
 * control points tilts the tangent, and the arrowhead comes with it: nothing
 * rotates the marker, the line simply arrives pointing where it looks like it
 * is pointing.
 */
export function arrow(from: Rect, to: Rect): string {
  const { start, end, horizontal } = facingSides(from, to);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = Math.hypot(dx, dy) || 1;

  // Straight out of the side it leaves by, and straight into the side it
  // arrives at — before the lean.
  const square = horizontal
    ? { x: dx >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: dy >= 0 ? 1 : -1 };
  // Where the connector is heading overall.
  const along = { x: dx / span, y: dy / span };

  const leaning = {
    x: square.x * (1 - TILT) + along.x * TILT,
    y: square.y * (1 - TILT) + along.y * TILT,
  };
  const size = Math.hypot(leaning.x, leaning.y) || 1;
  const dir = { x: leaning.x / size, y: leaning.y / size };

  /**
   * Never more than half the distance, however far apart the dominant axis
   * says they are — leaning the handles points them partly at each other, and
   * two long ones would meet and throw a loop into the middle of the curve.
   */
  const reach = Math.max(24, (horizontal ? Math.abs(dx) : Math.abs(dy)) / 2);
  const bend = Math.min(reach, span / 2);

  const lead = { x: start.x + dir.x * bend, y: start.y + dir.y * bend };
  const trail = { x: end.x - dir.x * bend, y: end.y - dir.y * bend };

  return `M ${start.x} ${start.y} C ${lead.x} ${lead.y}, ${trail.x} ${trail.y}, ${end.x} ${end.y}`;
}

/** The direction a connector points as it lands, for checking it looks right. */
export function arrivalAngle(from: Rect, to: Rect): number {
  const { start, end, horizontal } = facingSides(from, to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = Math.hypot(dx, dy) || 1;
  const square = horizontal
    ? { x: dx >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: dy >= 0 ? 1 : -1 };
  return (
    (Math.atan2(
      square.y * (1 - TILT) + (dy / span) * TILT,
      square.x * (1 - TILT) + (dx / span) * TILT,
    ) *
      180) /
    Math.PI
  );
}

/**
 * A placement laid over the one already held.
 *
 * A drag says only what it changed. Dragging a region sends its own corner and
 * nothing about where the opening inside it was put, because the drag did not
 * touch that — so taking the new record whole threw the opening back to the
 * corner it starts in. It survived a reload, since the write coalesces the
 * missing fields against what is stored, which is what made it look like the
 * card was popping back rather than being lost.
 *
 * Absent means unchanged, here as in the write.
 */
export function mergePlacement(
  held: CanvasNode | undefined,
  moved: CanvasNode,
): CanvasNode {
  if (!held) return moved;
  return {
    ...held,
    ...moved,
    selfX: moved.selfX ?? held.selfX,
    selfY: moved.selfY ?? held.selfY,
    selfW: moved.selfW ?? held.selfW,
    selfH: moved.selfH ?? held.selfH,
  };
}

/** What a block looks like on the canvas before anyone has moved it. */
const DEFAULT_W = 260;
const DEFAULT_H = 120;
/** Room inside a region for its children, and between siblings. */
export const PADDING = 28;
export const GAP = 44;
/** The band along the top of a region that carries its own name. */
const HEADER = 34;

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
export interface Placed {
  id: string;
  /** The rectangle drawn on screen. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The corner this node's saved position is measured from its parent, and —
   * for a region — the corner its own children are measured from.
   *
   * The same as `x`/`y` for a card. A region's rectangle is the bounding box of
   * what it holds, so dragging a scene up and to the left extends the region up
   * and to the left with it; but the corner every position inside is stored
   * against must not move, or every child's saved offset would change to mean
   * the same place and the layout would walk on each redraw.
   */
  anchorX: number;
  anchorY: number;
  depth: number;
  parentId: string | null;
  item: CanvasBlock;
  /** A region's own prose, drawn as the first card inside it. */
  isSelfCard: boolean;
}

/** Extents relative to whatever corner they were measured from. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * How many things go in a row, for a generation of that many.
 *
 * The square root, so a generation lands in a roughly square block: nine
 * chapters make three rows of three, forty make six rows or so. That is the
 * shape that wastes least on an endless surface and reads best zoomed out.
 *
 * Counted rather than measured against a width, which is what the first
 * attempt did and why chapters still stacked in a column — a chapter region is
 * wider than any sensible row target, being itself a wrapped grid of scenes, so
 * every one of them overflowed the row immediately and took a line of its own.
 * Items that *are* the width cannot be packed by width.
 */
function perRow(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

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
export function selfCardId(blockId: string): string {
  return `${blockId}::self`;
}

/**
 * The corner a region measures its contents from.
 *
 * Inset from the region's own rectangle by its title bar and a margin. Every
 * position inside a region is stored against this corner, so it has to be
 * worked out in exactly one place: the last bug here was two pieces of code
 * that each had their own idea of where it was.
 */
export function innerCorner(x: number, y: number): { x: number; y: number } {
  return { x: x + PADDING, y: y + HEADER + PADDING };
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
export function layout(
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

  /**
   * `originX`/`originY` are the corner everything here is measured from — the
   * same corner a saved position is stored against. `flowFrom` is only where the
   * first *unplaced* thing starts, which is below the region's opening card.
   *
   * Keeping those two apart is the whole of it. They were one before, so a
   * child was laid out below the opening and then written down as though the
   * corner were below the opening too — and the next draw added that height
   * again, and the one after that again, until the region had a hole in it and
   * had grown through its neighbours.
   */
  const place = (
    parentId: string | null,
    originX: number,
    originY: number,
    depth: number,
    flowFrom = originY,
  ): Box | null => {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return null;

    // Where the next unplaced thing goes, wrapping when the row is full.
    const across = perRow(children.filter((c) => !saved.has(c.block.id)).length);
    let rowX = originX;
    let rowY = flowFrom;
    let rowH = 0;
    let inRow = 0;
    let box: Box | null = null;

    const advance = (w: number, h: number): { x: number; y: number } => {
      if (inRow >= across) {
        rowX = originX;
        rowY += rowH + GAP;
        rowH = 0;
        inRow = 0;
      }
      const at = { x: rowX, y: rowY };
      rowX += w + GAP;
      rowH = Math.max(rowH, h);
      inRow += 1;
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

      let rect = { x: guess.x, y: guess.y, w: own?.w ?? DEFAULT_W, h: own?.h ?? DEFAULT_H };
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
        const inner = innerCorner(guess.x, guess.y);
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
          anchorX: selfAt.x,
          anchorY: selfAt.y,
          depth: depth + 1,
          parentId: item.block.id,
          item,
          isSelfCard: true,
        });

        // The rest flow below wherever the opening ended up, so a moved card
        // pushes its scenes rather than sitting on them.
        const below = place(
          item.block.id,
          inner.x,
          inner.y,
          depth + 1,
          // Unplaced scenes begin under the opening; placed ones are wherever
          // they were put, measured from the corner above.
          selfAt.y + selfH + GAP,
        );

        /**
         * A region is the bounding box of everything it holds, with a margin
         * all round and its title bar above.
         *
         * A box rather than a width and a height, so it follows a child in
         * whichever direction that child was dragged. Sized from the far edges
         * alone it only ever grew right and down: a scene dragged up or left
         * simply walked out through the border and the chapter sat there
         * unchanged.
         *
         * `anchor` stays where it was through all of this. The rectangle may
         * move; the corner positions inside are stored against may not.
         */
        const held = union(below, {
          left: selfAt.x - inner.x,
          top: selfAt.y - inner.y,
          right: selfAt.x - inner.x + selfW,
          bottom: selfAt.y - inner.y + selfH,
        })!;

        rect = {
          x: inner.x + held.left - PADDING,
          y: inner.y + held.top - PADDING - HEADER,
          w: held.right - held.left + PADDING * 2,
          h: held.bottom - held.top + PADDING * 2 + HEADER,
        };
      }

      if (!own) {
        // The row only knew the guessed size; a grown region needs more room.
        // Where it ends up is recorded after the rows have been mirrored.
        rowX = Math.max(rowX, rect.x + rect.w + GAP);
        rowH = Math.max(rowH, rect.h);
      }

      placed.push({
        id: item.block.id,
        ...rect,
        anchorX: guess.x,
        anchorY: guess.y,
        depth,
        parentId,
        item,
        isSelfCard: false,
      });

      box = union(box, {
        left: rect.x - originX,
        top: rect.y - originY,
        right: rect.x - originX + rect.w,
        bottom: rect.y - originY + rect.h,
      });
    }

    return box;
  };

  place(null, 0, 0, 0);

  /**
   * Every other row runs the other way.
   *
   * Packed all left-to-right, the last node of a row has to reach back across
   * the whole width to the first node of the next — so it leaves by the same
   * edge its own arrow arrived at, and the two lines lie on top of each other.
   * Reversing alternate rows makes the sequence a boustrophedon: within a row a
   * node is entered on one side and left on the other, and at a wrap the link
   * simply drops to the row below.
   *
   * Done afterwards rather than during, because a row cannot be mirrored until
   * every node in it has its final size — and a region has no size until its
   * children have theirs. Moving a node carries its subtree, since children
   * were laid out against their parent's corner.
   */
  const kids = new Map<string | null, Placed[]>();
  for (const p of placed) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p]);

  const shift = (node: Placed, dx: number) => {
    node.x += dx;
    node.anchorX += dx;
    for (const child of kids.get(node.id) ?? []) shift(child, dx);
  };

  for (const [, group] of kids) {
    // Only what was laid out here: anything the writer placed stays put.
    const fresh = group.filter((p) => !p.isSelfCard && !saved.has(p.id));
    if (fresh.length < 2) continue;

    const rows = new Map<number, Placed[]>();
    for (const p of fresh) rows.set(p.anchorY, [...(rows.get(p.anchorY) ?? []), p]);

    const order = [...rows.keys()].sort((a, b) => a - b);
    for (const [index, y] of order.entries()) {
      if (index % 2 === 0) continue;
      const row = (rows.get(y) ?? []).slice().sort((a, b) => a.x - b.x);
      if (row.length < 2) continue;

      // Mirrored about the row's own extent, so it occupies the same space.
      const left = row[0]!.x;
      const right = row[row.length - 1]!.x + row[row.length - 1]!.w;

      // Worked out against the row as it stands, then applied: shifting as we
      // go would measure each node against positions already moved.
      const moves = row.map((node) => ({ node, dx: left + right - node.w - 2 * node.x }));
      for (const { node, dx } of moves) shift(node, dx);
    }
  }

  /**
   * What to write back, taken from the final positions.
   *
   * Collected here rather than as each node was placed, because the rows are
   * mirrored afterwards — anything gathered earlier would record where a node
   * was before it moved, and the next load would undo the arrangement it had
   * just been given.
   */
  const origin = new Map<string | null, { x: number; y: number }>([[null, { x: 0, y: 0 }]]);
  for (const p of placed) {
    origin.set(p.id, innerCorner(p.anchorX, p.anchorY));
  }
  for (const p of placed) {
    if (p.isSelfCard || saved.has(p.id)) continue;
    const from = origin.get(p.parentId) ?? { x: 0, y: 0 };
    unsaved.push({
      blockId: p.id,
      x: p.anchorX - from.x,
      y: p.anchorY - from.y,
      w: p.w,
      h: p.h,
    });
  }


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

