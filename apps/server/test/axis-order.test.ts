import assert from "node:assert/strict";
import { AXIS_KEYS } from "../src/ollama/frameworks.js";

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

/**
 * How jagged the polygon is: the total climb around the ring.
 *
 * Not a measure of the character — the same scores in a different order give a
 * different number, which is precisely the point. It measures how much of the
 * shape the layout invented.
 */
function roughness(order: readonly string[], scores: Record<string, number>): number {
  let total = 0;
  for (let i = 0; i < order.length; i += 1) {
    const here = scores[order[i]!] ?? 0;
    const next = scores[order[(i + 1) % order.length]!] ?? 0;
    total += Math.abs(here - next);
  }
  return total;
}

const WAS = ["hero","mentor","shadow","shapeshifter","trickster","ally","guardian","rival","beloved","sacrifice"];

/** Tuan, exactly as the profile scored him. */
const tuan = {
  hero: 0, mentor: 5, shadow: 1, shapeshifter: 2, trickster: 3,
  ally: 4, guardian: 2, rival: 0, beloved: 0, sacrifice: 5,
};

console.log("where the spokes go");

check("every axis still appears exactly once", () => {
  assert.equal(AXIS_KEYS.length, 10);
  assert.equal(new Set(AXIS_KEYS).size, 10);
  assert.deepEqual([...AXIS_KEYS].sort(), [...WAS].sort());
});

check("the rubric's alternatives sit opposite each other", () => {
  const across = (a: string, b: string) => {
    const i = AXIS_KEYS.indexOf(a as never);
    const j = AXIS_KEYS.indexOf(b as never);
    assert.equal(Math.abs(i - j), AXIS_KEYS.length / 2, `${a} should face ${b}`);
  };
  across("hero", "shadow");
  across("ally", "rival");
  across("mentor", "trickster");
  across("sacrifice", "shapeshifter");
  across("beloved", "guardian");
});

check("a mentor-death draws as one shape, not two spikes", () => {
  const i = AXIS_KEYS.indexOf("mentor");
  const j = AXIS_KEYS.indexOf("sacrifice");
  assert.equal(Math.abs(i - j), 1, "the rubric's classic dual score should be adjacent");
});

check("Tuan's profile is measurably less jagged", () => {
  const before = roughness(WAS, tuan);
  const after = roughness(AXIS_KEYS, tuan);
  console.log(`       climb around the ring: ${before} before, ${after} after`);
  assert.ok(after < before, `expected less than ${before}, got ${after}`);
});

/**
 * The divider drawn across the chart claims the two halves mean something. If a
 * later reorder breaks that, the line stops being a reading aid and becomes a
 * false claim about the character — so the claim is asserted here rather than
 * left to whoever next edits the list.
 */
check("the halves are the two kinds of function", () => {
  const carries = ["hero", "ally", "mentor", "sacrifice", "beloved"];
  const resists = ["shadow", "rival", "trickster", "shapeshifter", "guardian"];
  assert.deepEqual(AXIS_KEYS.slice(0, 5), carries, "first half carries the arc");
  assert.deepEqual(AXIS_KEYS.slice(5), resists, "second half resists it");
});

check("the divider is a diameter, drawn between spokes", () => {
  const count = AXIS_KEYS.length;
  const angle = (i: number) => ((Math.PI * 2 * i) / count - Math.PI / 2);
  const a = angle(count - 0.5);
  const b = angle(count / 2 - 0.5);
  // Half a turn apart, so it is one straight line through the centre.
  assert.ok(Math.abs(Math.abs(a - b) - Math.PI) < 1e-9, "the two ends must be opposite");
  // And exactly between the spokes it separates, not on top of either.
  assert.ok(Math.abs(a - (angle(count - 1) + angle(count)) / 2) < 1e-9);
});

console.log(`\n${passed} passed`);
