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
  ): { w: number; h: number } => {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return { w: 0, h: 0 };

    // Where the next unplaced thing goes, wrapping when the row is full.
    const across = perRow(children.filter((c) => !saved.has(c.block.id)).length);
    let rowX = originX;
    let rowY = flowFrom;
    let rowH = 0;
    let inRow = 0;
    let widest = 0;
    let deepest = originY;

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
         * The opening and the scenes are measured from the same corner, so the
         * region is as tall and as wide as whichever reaches further.
         */
        inside = {
          w: Math.max(below.w, selfAt.x - inner.x + selfW),
          h: Math.max(below.h, selfAt.y - inner.y + selfH),
        };
      }

      /**
       * A region is exactly as big as what it holds, rather than the larger of
       * that and whatever it was last time. Kept as a maximum it could only
       * ever grow: dragging a scene rightwards widened its chapter, and
       * dragging it back left left the chapter stretched around empty space.
       *
       * There is nothing lost by not remembering — a region's size was never
       * the writer's to choose. Only cards carry one.
       */
      const w = isRegion ? inside.w + PADDING * 2 : (own?.w ?? DEFAULT_W);
      const h = isRegion ? inside.h + HEADER + PADDING * 2 : (own?.h ?? DEFAULT_H);

      if (!own) {
        // The row only knew the guessed size; a grown region needs more room.
        // Where it ends up is recorded after the rows have been mirrored.
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
    for (const child of kids.get(node.id) ?? []) shift(child, dx);
  };

  for (const [, group] of kids) {
    // Only what was laid out here: anything the writer placed stays put.
    const fresh = group.filter((p) => !p.isSelfCard && !saved.has(p.id));
    if (fresh.length < 2) continue;

    const rows = new Map<number, Placed[]>();
    for (const p of fresh) rows.set(p.y, [...(rows.get(p.y) ?? []), p]);

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
    origin.set(p.id, innerCorner(p.x, p.y));
  }
  for (const p of placed) {
    if (p.isSelfCard || saved.has(p.id)) continue;
    const from = origin.get(p.parentId) ?? { x: 0, y: 0 };
    unsaved.push({ blockId: p.id, x: p.x - from.x, y: p.y - from.y, w: p.w, h: p.h });
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

