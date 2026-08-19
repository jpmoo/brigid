import assert from "node:assert/strict";
import { foldName } from "@brigid/shared";

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

/** Exactly the predicate resetCharacter filters on. */
const settledAbout = (
  rows: { characterName: string; originName: string }[],
  name: string,
) => {
  const wanted = foldName(name);
  return rows.filter((r) => foldName(r.characterName) === wanted);
};

const rows = [
  { characterName: "Boudicca", originName: "Boudicca" },
  // A spelling difference the roster hides and an exact match would miss.
  { characterName: "the Colonel", originName: "the Colonel" },
  { characterName: "Colonel", originName: "Colonel" },
  // Read as Boudicca, given to someone else. Still a decision about Boudicca.
  { characterName: "Stephen", originName: "Boudicca" },
  // Nothing to do with either.
  { characterName: "Stephen", originName: "Stephen" },
];

console.log("clearing a character");

check("takes rows stored under a different spelling", () => {
  assert.equal(settledAbout(rows, "Colonel").length, 2);
});

check("is not case-sensitive", () => {
  assert.deepEqual(settledAbout(rows, "boudicca"), settledAbout(rows, "Boudicca"));
  assert.equal(settledAbout(rows, "boudicca").length, 1);
});

/**
 * The one that bit. Clearing the character a line was first read as must not
 * reach into the character the writer moved it to — that empties someone else's
 * record as a side effect of tidying this one.
 */
check("leaves lines the writer moved to someone else", () => {
  const got = settledAbout(rows, "Boudicca");
  assert.equal(got.length, 1);
  assert.equal(got[0]!.characterName, "Boudicca");
  assert.ok(!got.some((r) => r.characterName === "Stephen"), "the reassigned line stays put");
});

check("leaves other characters alone", () => {
  const got = settledAbout(rows, "Boudicca");
  assert.equal(got.some((r) => r.characterName === "Stephen" && r.originName === "Stephen"), false);
});

check("an exact match would still have missed the spelling variants", () => {
  assert.equal(rows.filter((r) => r.characterName === "Colonel").length, 1);
  assert.equal(settledAbout(rows, "Colonel").length, 2);
});

console.log(`\n${passed} passed`);
