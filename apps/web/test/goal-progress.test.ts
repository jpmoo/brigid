import assert from "node:assert/strict";
import { goalReport } from "../src/pages/settings/GoalProgress.js";
import type { Block, Template, WorkLevel } from "../src/api.js";

let passed = 0;
const check = (name: string, run: () => void) => {
  try {
    run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n")[0]}`);
    process.exitCode = 1;
  }
};

const CHAPTER = "fmt-chapter";
const TITLE = "fmt-title";

const templates = [
  { id: CHAPTER, formatSettings: { structural: true } },
  // A title page has no length to fall short of.
  { id: TITLE, formatSettings: { structural: false } },
] as unknown as Template[];

const levels = [
  { depth: 0, name: "Chapters", wordGoal: 3000 },
  { depth: 1, name: "Sections", wordGoal: null },
] as unknown as WorkLevel[];

const block = (
  id: string,
  parentId: string | null,
  sortKey: string,
  words: number,
  formatId = CHAPTER,
): Block => ({ id, parentId, sortKey, label: id, formatId, wordCount: words }) as unknown as Block;

/**
 * A title page, then two chapters. The first is short on its own but its
 * sections carry it past the goal; the second is genuinely behind.
 */
const blocks = [
  block("Title", null, "a0", 12, TITLE),
  block("One", null, "a1", 100),
  block("1.1", "One", "b1", 1600),
  block("1.2", "One", "b2", 1500),
  block("Two", null, "a2", 200),
  block("2.1", "Two", "b1", 800),
];

console.log("how we're doing");

check("a chapter is judged on everything under it", () => {
  const { perLevel } = goalReport(blocks, levels, templates);
  const chapters = perLevel.find((l) => l.name === "Chapters")!;
  // One totals 100 + 1600 + 1500 = 3200, past the goal. Two totals 1000.
  assert.equal(chapters.met, 1);
  assert.equal(chapters.total, 2);
  assert.equal(chapters.shortfall, 2000);
  assert.equal(chapters.worst?.label, "Two");
  assert.equal(chapters.worst?.words, 1000);
});

check("the title page is not counted as a chapter falling short", () => {
  const { perLevel } = goalReport(blocks, levels, templates);
  // Three blocks sit at depth 0; only two of them carry a goal.
  assert.equal(perLevel.find((l) => l.name === "Chapters")!.total, 2);
});

check("the title page's words stay out of the manuscript total", () => {
  const { written } = goalReport(blocks, levels, templates);
  assert.equal(written, 100 + 1600 + 1500 + 200 + 800);
});

check("a level with no goal is not reported on", () => {
  const { perLevel } = goalReport(blocks, levels, templates);
  assert.equal(perLevel.some((l) => l.name === "Sections"), false);
});

check("nothing to report when no goals are set", () => {
  const none = [{ depth: 0, name: "Chapters", wordGoal: null }] as unknown as WorkLevel[];
  assert.equal(goalReport(blocks, none, templates).perLevel.length, 0);
});

console.log(`\n${passed} passed`);
