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
  return rows.filter(
    (r) => foldName(r.characterName) === wanted || foldName(r.originName) === wanted,
  );
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
  assert.equal(settledAbout(rows, "boudicca").length, 2);
});

check("takes back lines that were moved away", () => {
  const got = settledAbout(rows, "Boudicca");
  assert.equal(got.length, 2);
  assert.ok(got.some((r) => r.characterName === "Stephen"), "the reassigned line comes back");
});

check("leaves other characters alone", () => {
  const got = settledAbout(rows, "Boudicca");
  assert.equal(got.some((r) => r.characterName === "Stephen" && r.originName === "Stephen"), false);
});

check("an exact match would have missed most of it", () => {
  const naive = rows.filter((r) => r.characterName === "Boudicca");
  assert.equal(naive.length, 1);
  assert.equal(settledAbout(rows, "Boudicca").length, 2);
});

console.log(`\n${passed} passed`);
