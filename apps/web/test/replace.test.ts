import assert from "node:assert/strict";
import {
  inCaseOf,
  occurrencesIn,
  proseFromParagraphs,
  proseToText,
  replaceInDoc,
  smartenText,
} from "@brigid/shared";
import type { ProseDoc } from "@brigid/shared";
import { findMatches } from "../src/components/SearchBar.js";

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

const doc = (...paragraphs: string[]) => proseFromParagraphs(paragraphs);

console.log("find and replace");

/**
 * The rule the module exists to keep. Find counts over the text as shown —
 * smartened, where the format smartens — and Replace edits the text as stored.
 * If the two ever count differently, "replace this one" replaces the wrong one.
 */
check("counts exactly what Find counts, smartened or not", () => {
  const paragraphs = [
    `He said "wait--no," and then--nothing.`,
    `Three---dashes, four----dashes, and a lone - hyphen.`,
    `It trailed off... and off.... 'Don't,' she said.`,
    `THE captain, the Captain, the captain's hat.`,
    `A--B--C, a - b, a-b.`,
  ];
  const needles = ["-", "--", "a-b", "the captain", "'", '"', "...", ".", "off", "wait-no", "dashes"];

  for (const smartens of [true, false]) {
    for (const text of paragraphs) {
      for (const needle of needles) {
        const shown = smartens ? smartenText(text) : text;
        const find = findMatches([{ id: "b", contentText: shown }], needle).length;
        const ours = occurrencesIn(doc(text), needle, smartens).length;
        assert.equal(ours, find, `"${needle}" in ${JSON.stringify(text)} (smartens: ${smartens})`);
      }
    }
  }
});

check("a smartened dash is replaced whole", () => {
  // Find sees "a—b"; the page stores "a--b". Replacing must not leave a hyphen.
  const { doc: out } = replaceInDoc(doc("a--b and more"), "a-b", "x", true, "all");
  assert.equal(proseToText(out), "x and more");
});

check("replaces the one asked for and no other", () => {
  const { doc: out, replaced } = replaceInDoc(doc("cat one cat two", "cat three"), "cat", "dog", false, 1);
  assert.equal(replaced, 1);
  assert.equal(proseToText(out), "cat one dog two\n\ncat three");
});

check("replaces all of them, across paragraphs", () => {
  const { doc: out, replaced } = replaceInDoc(doc("cat one cat two", "cat three"), "cat", "dog", false, "all");
  assert.equal(replaced, 3);
  assert.equal(proseToText(out), "dog one dog two\n\ndog three");
});

check("a replacement containing the query does not run away", () => {
  const { doc: out, replaced } = replaceInDoc(doc("cat and cat"), "cat", "cats", false, "all");
  assert.equal(replaced, 2);
  assert.equal(proseToText(out), "cats and cats");
});

check("italics around the match survive", () => {
  const italic: ProseDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "She read " },
          { type: "text", text: "The Recieving Line", marks: [{ type: "em" }] },
          { type: "text", text: " twice." },
        ],
      },
    ],
  };
  const { doc: out } = replaceInDoc(italic, "recieving", "receiving", false, "all");
  const runs = out.content[0]!.content!;
  assert.equal(runs.length, 3, "still three runs, not a seam where it went in");
  assert.equal(runs[1]!.text, "The Receiving Line");
  assert.deepEqual(runs[1]!.marks, [{ type: "em" }]);
  assert.equal(runs[2]!.marks, undefined, "the roman after it stays roman");
});

check("a match across an italic boundary takes the marks it starts in", () => {
  const split: ProseDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "re", marks: [{ type: "em" }] },
          { type: "text", text: "cieve it" },
        ],
      },
    ],
  };
  const { doc: out } = replaceInDoc(split, "recieve", "receive", false, "all");
  const runs = out.content[0]!.content!;
  assert.equal(runs[0]!.text, "receive");
  assert.deepEqual(runs[0]!.marks, [{ type: "em" }]);
  assert.equal(runs[1]!.text, " it");
});

check("a blockquote stays a blockquote", () => {
  const quoted: ProseDoc = {
    type: "doc",
    content: [{ type: "paragraph", blockquote: true, content: [{ type: "text", text: "Dear cat," }] }],
  };
  const { doc: out } = replaceInDoc(quoted, "cat", "dog", false, "all");
  assert.equal(out.content[0]!.blockquote, true);
});

check("characters outside the basic plane are not split", () => {
  const { doc: out } = replaceInDoc(doc("🐉 cat 🐉 cat"), "cat", "dog", false, 1);
  assert.equal(proseToText(out), "🐉 cat 🐉 dog");
});

check("nothing found, nothing changed", () => {
  const before = doc("no match here");
  const { doc: out, replaced } = replaceInDoc(before, "zebra", "x", false, "all");
  assert.equal(replaced, 0);
  assert.equal(out, before);
});

/**
 * Find ignores case, so a lower-case replacement would put a lower-case letter
 * at the head of a sentence. Only when the writer has not said otherwise.
 */
check("a lower-case replacement follows the case of what it replaces", () => {
  assert.equal(inCaseOf("The captain", "the commander"), "The commander");
  assert.equal(inCaseOf("THE CAPTAIN", "the commander"), "THE COMMANDER");
  assert.equal(inCaseOf("the captain", "the commander"), "the commander");
});

check("a replacement with capitals of its own is used as typed", () => {
  assert.equal(inCaseOf("the mcallister boy", "the McAllister boy"), "the McAllister boy");
  assert.equal(inCaseOf("Tuan", "Tuán"), "Tuán");
});

check("case follows the match inside a document", () => {
  const { doc: out } = replaceInDoc(doc("The captain fell. Then the captain rose."), "the captain", "the commander", false, "all");
  assert.equal(proseToText(out), "The commander fell. Then the commander rose.");
});

console.log(`\n${passed} passed`);
