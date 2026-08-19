import assert from "node:assert/strict";
import { wordDelta } from "../src/blocks/activity.js";

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

console.log("what changed, in words");

check("writing counts as added and nothing else", () => {
  assert.deepEqual(wordDelta("", "He remembered his name."), { added: 4, deleted: 0 });
});

check("cutting counts as deleted and nothing else", () => {
  assert.deepEqual(wordDelta("He remembered his name.", ""), { added: 0, deleted: 4 });
});

/**
 * The case a net count gets exactly backwards. Four hundred words in and three
 * hundred and ninety out is a hard morning; a word count calls it ten.
 */
check("a rewrite is both directions at once", () => {
  const before = "The battle ebbed and flowed.";
  const after = "The fighting surged and broke.";
  const { added, deleted } = wordDelta(before, after);
  assert.equal(added, 3, "fighting, surged, broke");
  assert.equal(deleted, 3, "battle, ebbed, flowed");
});

check("moving a paragraph is neither", () => {
  const a = "She turned.\n\nHe waited by the door.";
  const b = "He waited by the door.\n\nShe turned.";
  assert.deepEqual(wordDelta(a, b), { added: 0, deleted: 0 });
});

check("repunctuating is not writing", () => {
  const a = "She turned. She made a gesture.";
  const b = "She turned, and she made a gesture!";
  const { added, deleted } = wordDelta(a, b);
  // Punctuation is not a word, and "she" was already there twice. Only the
  // conjunction is new — which is the whole claim: moving commas around does
  // not register as a morning's work.
  assert.deepEqual({ added, deleted }, { added: 1, deleted: 0 });
});

check("repeated words are counted, not collapsed", () => {
  assert.deepEqual(wordDelta("the the the", "the"), { added: 0, deleted: 2 });
});

check("case is not a change", () => {
  assert.deepEqual(wordDelta("Attack", "attack"), { added: 0, deleted: 0 });
});

check("saving with nothing altered records nothing", () => {
  const text = "Boudicca looked at me. I said that word again.";
  assert.deepEqual(wordDelta(text, text), { added: 0, deleted: 0 });
});

console.log(`\n${passed} passed`);
