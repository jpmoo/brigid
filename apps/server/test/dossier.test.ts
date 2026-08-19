import assert from "node:assert/strict";
import { dossierFromCast, timelineFor } from "../src/ollama/analysis.js";
import type { PlacedDigest } from "@brigid/shared";

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

const sections = [
  {
    blockId: "b1",
    label: "Chapter One",
    start: 0,
    end: 0.5,
    words: 1200,
    summary: "The band is driven back through the ruin.",
    events: [{ what: "the captain is killed", kind: "turn", who: ["Tuan", "Boudicca"] }],
    characters: [],
  },
] as unknown as PlacedDigest[];

const rows = [
  // Settled under Tuan.
  { characterName: "Tuan", action: "holds the line at the wall", blockId: "b1", state: "committed" },
  // Moved to Boudicca by the writer: no longer Tuan's.
  { characterName: "Boudicca", action: "swings the great hammer", blockId: "b1", state: "committed" },
  // Thrown out entirely.
  { characterName: "Tuan", action: "invents a speech nobody made", blockId: "b1", state: "dropped" },
  // Still in the queue, not yet agreed to.
  { characterName: "Tuan", action: "waits by the chariot", blockId: "b1", state: "pending" },
];

console.log("what a profile is allowed to see");

check("the record holds only what was settled under this character", () => {
  const dossier = dossierFromCast(rows, sections, "Tuan");
  assert.ok(dossier.includes("holds the line"), "the committed action is there");
  assert.ok(!dossier.includes("great hammer"), "an action moved away is not");
  assert.ok(!dossier.includes("invents a speech"), "a thrown-out action is not");
  assert.ok(!dossier.includes("waits by the chariot"), "an unsettled action is not");
});

/**
 * The bug this is here for: the timeline carried the reading's own attributions,
 * which are never revised, so a name the writer had moved off an action came
 * back to the model beside that action anyway.
 */
check("the timeline can be given without attributions", () => {
  const plain = timelineFor(sections, { attribute: false });
  assert.ok(plain.includes("the captain is killed"), "the event survives");
  assert.ok(!plain.includes("Tuan"), "the stale attribution does not");
});

check("and keeps them where nothing contradicts them", () => {
  const full = timelineFor(sections);
  assert.ok(full.includes("Tuan"), "structure and chat still get who was there");
});

console.log(`\n${passed} passed`);
