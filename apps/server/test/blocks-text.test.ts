import assert from "node:assert/strict";
import { paragraphs, measure } from "@brigid/shared";
import { extractText } from "../src/blocks/text.js";
import { hashContent, hashProse } from "../src/ollama/digest.js";

/**
 * The plain text a block stores has to keep its paragraphs.
 *
 * Everything downstream splits on a blank line: the style measurements, the
 * excerpts shown to the model as the writer's own prose, and the prose sent to
 * be read. When the paragraphs went in joined by a single space they all found
 * exactly one, and none of them said so — the numbers looked plausible, the
 * model answered, and "paragraph length" was quietly reporting the length of
 * the whole section.
 */

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n")[0]}`);
    process.exitCode = 1;
  }
};

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

console.log("\nplain text keeps its paragraphs");

check("four paragraphs stay four", () => {
  const doc = {
    type: "doc",
    content: [
      para("He remembered his name."),
      para("Martin lay on the ground, his right leg bent beneath it."),
      para("He was conscious of the battle, of his wounds, of the loss."),
      para("There was Aine, his wife."),
    ],
  };
  assert.equal(paragraphs(extractText(doc)).length, 4);
});

check("paragraph length is the paragraph, not the section", () => {
  const doc = { type: "doc", content: Array.from({ length: 8 }, () => para("Five words in this paragraph.")) };
  const m = measure(extractText(doc));
  // Eight paragraphs of five words: five, not forty.
  assert.equal(Math.round(m.overall["para.words"] ?? 0), 5);
});

check("a bold word does not open a gap mid-sentence", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "He said " },
          { type: "text", text: "nothing", marks: [{ type: "strong" }] },
          { type: "text", text: " at all." },
        ],
      },
    ],
  };
  assert.equal(extractText(doc), "He said nothing at all.");
});

check("paragraphs inside a blockquote are still paragraphs", () => {
  const doc = {
    type: "doc",
    content: [
      para("Before."),
      { type: "blockquote", content: [para("Quoted one."), para("Quoted two.")] },
      para("After."),
    ],
  };
  assert.equal(paragraphs(extractText(doc)).length, 4);
});

console.log("\ntwo questions, two hashes");

check("reflowing paragraphs does not make the reading stale", () => {
  // The same prose, before and after the paragraphs were put back.
  const flat = "He remembered his name. Martin lay on the ground.";
  const broken = "He remembered his name.\n\nMartin lay on the ground.";
  // What happens in the scene did not change, so the walk has nothing to redo.
  assert.equal(hashProse(flat), hashProse(broken));
  // Where the paragraphs fall did change, and that is what style measures.
  assert.notEqual(hashContent(flat), hashContent(broken));
});

check("real edits still count as changes", () => {
  assert.notEqual(
    hashProse("Martin lay on the ground."),
    hashProse("Martin lay on the stones."),
  );
});

console.log(`\n${passed} passed`);
