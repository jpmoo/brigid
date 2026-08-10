import assert from "node:assert/strict";
import type { CanvasNode } from "@brigid/shared";
import { innerCorner, layout, selfCardId } from "../src/components/canvas-layout.js";
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

console.log(failures === 0 ? "\ncanvas layout: all passed" : `\ncanvas layout: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
