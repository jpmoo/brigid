import assert from "node:assert/strict";
import type { CanvasNode } from "@brigid/shared";
import {
  arrivalAngle,
  arrow,
  innerCorner,
  mergePlacement,
  layout,
  selfCardId,
} from "../src/components/canvas-layout.js";
import type { CanvasBlock, Placed } from "../src/components/canvas-layout.js";

/**
 * The canvas laid out twice.
 *
 * Almost everything here is about the second draw rather than the first. A
 * layout is written back the moment it is chosen, so the arrangement a writer
 * actually looks at is the one produced by feeding those saved positions in
 * again — and a layout that measures against one corner and saves against
 * another looks perfectly correct the first time and drifts on every draw
 * after. Running it over its own output is the only way to see that.
 */

let failures = 0;
function test(name: string, run: () => void): void {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${(err as Error).message.split("\n").join("\n      ")}`);
  }
}

/** A manuscript of `chapters` chapters, each with `scenes` scenes under it. */
function manuscript(chapters: number, scenes: number): CanvasBlock[] {
  const items: CanvasBlock[] = [];
  for (let c = 1; c <= chapters; c += 1) {
    const id = `ch${c}`;
    items.push(block(id, null, scenes, `Chapter ${c}`));
    for (let s = 1; s <= scenes; s += 1) {
      items.push(block(`${id}-s${s}`, id, 0, `Scene ${c}.${s}`));
    }
  }
  return items;
}

function block(
  id: string,
  parentId: string | null,
  childCount: number,
  title: string,
): CanvasBlock {
  return {
    block: { id, parentId, title } as CanvasBlock["block"],
    levelName: parentId ? "Scene" : "Chapter",
    words: 1000,
    childCount,
    breakName: parentId ? null : "Chapter break",
    goal: null,
  };
}

const saveMap = (nodes: CanvasNode[]): Map<string, CanvasNode> =>
  new Map(nodes.map((n) => [n.blockId, n]));

const byId = (placed: Placed[]): Map<string, Placed> =>
  new Map(placed.filter((p) => !p.isSelfCard).map((p) => [p.id, p]));

function overlaps(a: Placed, b: Placed): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Every pair of siblings that share a parent and share space. */
function collisions(placed: Placed[]): string[] {
  const groups = new Map<string | null, Placed[]>();
  for (const p of placed) {
    if (p.isSelfCard) continue;
    groups.set(p.parentId, [...(groups.get(p.parentId) ?? []), p]);
  }
  const hits: string[] = [];
  for (const [, group] of groups) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]!;
        const b = group[j]!;
        if (overlaps(a, b)) hits.push(`${a.id} × ${b.id}`);
      }
    }
  }
  return hits;
}

console.log("canvas layout");

/**
 * The one that was wrong. Children were placed below the region's opening card
 * but written down as though the region's inner corner were below the opening
 * too, so each redraw added that card's height again — a widening band of empty
 * space inside every chapter, and chapters growing through their neighbours.
 */
test("a second draw from saved positions changes nothing", () => {
  const items = manuscript(9, 5);

  const first = layout(items, new Map());
  const second = layout(items, saveMap(first.unsaved));

  const a = byId(first.placed);
  const b = byId(second.placed);
  assert.equal(b.size, a.size, "same nodes");

  for (const [id, before] of a) {
    const after = b.get(id);
    assert.ok(after, `${id} present on the second draw`);
    assert.deepEqual(
      { x: after.x, y: after.y, w: after.w, h: after.h },
      { x: before.x, y: before.y, w: before.w, h: before.h },
      `${id} sat still`,
    );
  }
});

test("and nothing drifts over four more", () => {
  const items = manuscript(6, 4);
  let saved = layout(items, new Map()).unsaved;
  const anchor = byId(layout(items, saveMap(saved)).placed);

  for (let draw = 0; draw < 4; draw += 1) {
    const next = layout(items, saveMap(saved));
    saved = next.unsaved;
    for (const [id, p] of byId(next.placed)) {
      const was = anchor.get(id)!;
      assert.equal(p.y, was.y, `${id} held its line on draw ${draw + 2}`);
      assert.equal(p.x, was.x, `${id} held its column on draw ${draw + 2}`);
    }
  }
});

test("the gap under a chapter's opening is one gap, not two", () => {
  const items = manuscript(4, 4);
  const first = layout(items, new Map());
  const second = layout(items, saveMap(first.unsaved));

  for (const draw of [first, second]) {
    const opening = draw.placed.find((p) => p.id === selfCardId("ch1"))!;
    const scenes = draw.placed.filter((p) => p.parentId === "ch1" && !p.isSelfCard);
    const highest = Math.min(...scenes.map((p) => p.y));
    const gap = highest - (opening.y + opening.h);
    assert.ok(
      gap >= 0 && gap <= 60,
      `first scene sits ${gap}px under the opening, expected about 44`,
    );
  }
});

test("siblings never share space, on either draw", () => {
  const items = manuscript(9, 5);
  const first = layout(items, new Map());
  assert.deepEqual(collisions(first.placed), [], "first draw");

  const second = layout(items, saveMap(first.unsaved));
  assert.deepEqual(collisions(second.placed), [], "second draw");
});

test("a region contains every one of its children", () => {
  const items = manuscript(5, 6);
  const first = layout(items, new Map());
  const second = layout(items, saveMap(first.unsaved));

  for (const draw of [first, second]) {
    const regions = new Map(draw.placed.filter((p) => p.childCount > 0 || p.item.childCount > 0).map((p) => [p.id, p]));
    for (const child of draw.placed) {
      const parent = child.parentId ? regions.get(child.parentId) : null;
      if (!parent || parent.isSelfCard) continue;
      assert.ok(
        child.x >= parent.x &&
          child.y >= parent.y &&
          child.x + child.w <= parent.x + parent.w &&
          child.y + child.h <= parent.y + parent.h,
        `${child.id} escaped ${parent.id}`,
      );
    }
  }
});

/** A chapter grid, not a chapter column — the reason for counting rather than measuring. */
test("chapters are packed into rows, not stacked", () => {
  const { placed } = layout(manuscript(9, 3), new Map());
  const tops = placed.filter((p) => p.parentId === null);
  const rows = new Set(tops.map((p) => p.y));
  assert.ok(rows.size < tops.length, `${tops.length} chapters took ${rows.size} rows`);
});

/**
 * A region kept its size as a floor once, so it grew with a scene dragged out
 * to the right and stayed stretched when the scene came back.
 */
test("a region shrinks back when a scene is dragged in again", () => {
  const items = manuscript(3, 4);
  const first = layout(items, new Map());
  const settled = saveMap(first.unsaved);
  const at = (s: Map<string, CanvasNode>) => byId(layout(items, s).placed).get("ch1")!;

  const before = at(settled).w;

  const out = new Map(settled);
  out.set("ch1-s2", { ...settled.get("ch1-s2")!, x: 1400 });
  const stretched = at(out).w;
  assert.ok(stretched > before, `dragging out widened it: ${before} → ${stretched}`);

  const back = new Map(settled);
  assert.equal(at(back).w, before, "and dragging back in returned it");
});

/**
 * A region followed a child right and down but not up or left, because it was
 * sized from its far edges alone. A scene dragged up simply walked out through
 * the border and the chapter sat there unchanged.
 */
test("a region follows a child in whichever direction it is dragged", () => {
  const items = manuscript(3, 4);
  const settled = saveMap(layout(items, new Map()).unsaved);
  const at = (s: Map<string, CanvasNode>) => byId(layout(items, s).placed).get("ch1")!;
  const start = at(settled);

  const drags: [string, Partial<CanvasNode>, (r: Placed) => boolean, string][] = [
    ["right", { x: 1400 }, (r) => r.x + r.w > start.x + start.w, "its right edge moved out"],
    ["down", { y: 1400 }, (r) => r.y + r.h > start.y + start.h, "its bottom edge moved down"],
    ["left", { x: -1400 }, (r) => r.x < start.x, "its left edge moved out"],
    ["up", { y: -1400 }, (r) => r.y < start.y, "its top edge moved up"],
  ];

  for (const [way, patch, grew, what] of drags) {
    const next = new Map(settled);
    next.set("ch1-s2", { ...settled.get("ch1-s2")!, ...patch });
    assert.ok(grew(at(next)), `dragged ${way}: ${what}`);
  }
});

/**
 * And having followed it, the region still holds it — which is the whole point
 * of following. The check runs on the redraw after, because a region that grows
 * by moving its own corner is exactly how the offsets inside come to mean
 * something different from one draw to the next.
 */
test("a child dragged out in any direction is still inside afterwards", () => {
  const items = manuscript(3, 4);
  const settled = saveMap(layout(items, new Map()).unsaved);

  for (const [dx, dy] of [[900, 0], [0, 900], [-900, 0], [0, -900], [-700, -700]]) {
    const next = new Map(settled);
    const was = settled.get("ch1-s2")!;
    next.set("ch1-s2", { ...was, x: was.x + dx, y: was.y + dy });

    const drawn = layout(items, next);
    const again = layout(items, saveMap([...next.values(), ...drawn.unsaved]));

    for (const draw of [drawn, again]) {
      const region = byId(draw.placed).get("ch1")!;
      for (const child of draw.placed.filter((p) => p.parentId === "ch1")) {
        assert.ok(
          child.x >= region.x &&
            child.y >= region.y &&
            child.x + child.w <= region.x + region.w &&
            child.y + child.h <= region.y + region.h,
          `${child.id} left ch1 after a drag of ${dx},${dy}`,
        );
      }
    }
  }
});

/** Where the writer put something is the one thing a redraw may not touch. */
test("a moved card stays where it was put", () => {
  const items = manuscript(4, 4);
  const first = layout(items, new Map());
  const saved = saveMap(first.unsaved);

  const moved = { ...saved.get("ch1-s3")!, x: 900, y: 700 };
  saved.set("ch1-s3", moved);

  const { placed, unsaved } = layout(items, saved);
  const after = byId(placed).get("ch1-s3")!;
  const parent = byId(placed).get("ch1")!;

  // Asked for rather than written out, so a change to the inset moves the test
  // with the code instead of breaking it.
  const corner = innerCorner(parent.x, parent.y);
  assert.equal(after.x - corner.x, 900, "kept its offset across");
  assert.equal(after.y - corner.y, 700, "kept its offset down");
  assert.ok(
    !unsaved.some((n) => n.blockId === "ch1-s3"),
    "a placed card is not written back over",
  );
});

/**
 * The arrowhead orients itself to the curve's tangent where it lands, so the
 * only way to tilt it is to tilt the arrival. Held square to the face, a
 * connector crossing at an angle ended in an arrowhead pointing flatly
 * sideways with a kink in the last few pixels.
 */
console.log("\ncanvas connectors");

const box = (x: number, y: number, w = 260, h = 120) => ({ x, y, w, h });

test("a connector crossing at an angle lands at an angle", () => {
  // To the right and well below: the sides that face are left and right, so
  // this used to arrive dead horizontal.
  const angle = arrivalAngle(box(0, 0), box(600, 400));
  assert.ok(
    Math.abs(angle) > 8 && Math.abs(angle) < 82,
    `arrived at ${angle.toFixed(1)}°, wanted something between square and straight`,
  );
});

test("and one crossing straight still lands straight", () => {
  // Level with each other: there is no angle to lean into.
  assert.equal(Math.round(arrivalAngle(box(0, 0), box(600, 0))), 0);
  // Directly below: straight down.
  assert.equal(Math.round(arrivalAngle(box(0, 0), box(0, 600))), 90);
});

test("the lean never doubles back on itself", () => {
  // A handle longer than the gap would meet its opposite and throw a loop into
  // the middle of the curve.
  for (const [dx, dy] of [[40, 900], [900, 40], [300, 300], [-500, 250]]) {
    const d = arrow(box(0, 0), box(dx, dy));
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    assert.ok(nums.every(Number.isFinite), `finite path for ${dx},${dy}: ${d}`);
  }
});

test("it always leans towards the way the line is travelling", () => {
  // Both arrive from above or below, so square-on is ±90 and any lean shows as
  // an angle strictly inside that. Asserting only the sign would pass without
  // any lean at all, which is the thing being tested.
  const down = arrivalAngle(box(0, 0), box(600, 400));
  assert.ok(down > 0 && down < 89, `down-right leaned to ${down.toFixed(1)}°`);

  const up = arrivalAngle(box(0, 400), box(600, 0));
  assert.ok(up < 0 && up > -89, `up-right leaned to ${up.toFixed(1)}°`);

  // Leftwards, so the lean goes the other way along the x axis.
  const back = arrivalAngle(box(600, 0), box(0, 400));
  assert.ok(back > 91 && back < 180, `down-left leaned to ${back.toFixed(1)}°`);
});

/**
 * A drag says only what it changed, so a placement has to be laid over the one
 * already held rather than taking its place.
 */
console.log("\nsaving a placement");

test("moving a chapter leaves its opening where it was put", () => {
  const items = manuscript(3, 3);
  const settled = saveMap(layout(items, new Map()).unsaved);

  // The writer drags the opening card somewhere inside its chapter.
  const withOpening = new Map(settled);
  withOpening.set("ch1", { ...settled.get("ch1")!, selfX: 300, selfY: 180 });
  const before = layout(items, withOpening).placed.find(
    (p) => p.id === selfCardId("ch1"),
  )!;

  // Then drags the chapter itself, which says nothing about the opening.
  const drag = { blockId: "ch1", x: 900, y: 700, w: settled.get("ch1")!.w, h: settled.get("ch1")!.h };
  const after = new Map(withOpening);
  after.set("ch1", mergePlacement(withOpening.get("ch1"), drag));

  const kept = after.get("ch1")!;
  assert.equal(kept.selfX, 300, "the opening's offset across survived");
  assert.equal(kept.selfY, 180, "and its offset down");
  assert.equal(kept.x, 900, "while the chapter took its new corner");

  // And it is still drawn in the same place inside its chapter. Measured from
  // the anchor rather than from the drawn rectangle: a region's rectangle grows
  // around whatever has been dragged out of it and can end up above and left of
  // its own corner, but the corner things inside are stored against does not
  // move — which is the whole point of keeping the two apart.
  const drawn = layout(items, after).placed;
  const region = drawn.find((p) => p.id === "ch1" && !p.isSelfCard)!;
  const opening = drawn.find((p) => p.id === selfCardId("ch1"))!;
  const corner = innerCorner(region.anchorX, region.anchorY);
  assert.equal(opening.x - corner.x, 300, "same offset after the move");
  assert.equal(opening.y - corner.y, 180);
  assert.ok(before, "and it had one before");
});

test("a batch keeps both halves of a move", () => {
  // The region and the card inside it dragged in the same breath: merged, or
  // the second write would drop the first before it ever left the browser.
  const opening = { blockId: "ch1", x: 0, y: 0, w: 300, h: 200, selfX: 40, selfY: 60 };
  const region = { blockId: "ch1", x: 500, y: 400, w: 300, h: 200 };
  const merged = mergePlacement(opening, region);
  assert.deepEqual(
    { x: merged.x, y: merged.y, selfX: merged.selfX, selfY: merged.selfY },
    { x: 500, y: 400, selfX: 40, selfY: 60 },
  );
});

test("nothing to lay it over means it is taken whole", () => {
  const fresh = { blockId: "ch1", x: 10, y: 20, w: 260, h: 120 };
  assert.deepEqual(mergePlacement(undefined, fresh), fresh);
});

console.log(failures === 0 ? "\ncanvas layout: all passed" : `\ncanvas layout: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
