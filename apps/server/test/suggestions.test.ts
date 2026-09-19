import assert from "node:assert/strict";
import {
  acceptedDoc,
  asProseDoc,
  baseDoc,
  countWords,
  hasSuggestions,
  occurrencesIn,
  proposeFormatting,
  proseToText,
  replaceInDoc,
  resolveSuggestion,
  suggestionsIn,
} from "@brigid/shared";
import type { ProseDoc, ProseText } from "@brigid/shared";
import { extractText } from "../src/blocks/text.js";

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

const text = (t: string, ...marks: ProseText["marks"] & object): ProseText =>
  marks.length ? { type: "text", text: t, marks } : { type: "text", text: t };
const ins = (id: string) => ({ type: "ins" as const, id, at: "2026-09-19T10:00:00Z" });
const del = (id: string) => ({ type: "del" as const, id, at: "2026-09-19T10:00:00Z" });
const para = (...runs: ProseText[]): ProseDoc => ({ type: "doc", content: [{ type: "paragraph", content: runs }] });

/** "They would recieve the news." with "recieve" suggested as "receive", and " soon" suggested in. */
const proofed = para(
  text("They would "),
  text("recieve", del("r1")),
  text("receive", ins("r1")),
  text(" the news"),
  text(" soon", ins("a1")),
  text("."),
);

console.log("proofreading");

check("the manuscript as it stands leaves suggestions out", () => {
  assert.equal(proseToText(baseDoc(proofed)), "They would recieve the news.");
});

check("accepting everything gives the proofread text", () => {
  assert.equal(proseToText(acceptedDoc(proofed)), "They would receive the news soon.");
});

/**
 * The promise: nothing counts until accepted. The server's plain text feeds the
 * word count, goals, writing history and every analysis.
 */
check("a pending suggestion does not move the word count", () => {
  const plain = extractText(proofed);
  assert.equal(plain, "They would recieve the news.");
  assert.equal(countWords(plain), countWords("They would recieve the news."));
});

check("accepting a replacement settles both halves", () => {
  const done = resolveSuggestion(proofed, "r1", true);
  assert.equal(proseToText(baseDoc(done)), "They would receive the news.");
  assert.equal(suggestionsIn(done).length, 1, "only the addition is left");
});

check("rejecting a replacement puts the original back, whole", () => {
  const done = resolveSuggestion(proofed, "r1", false);
  assert.equal(proseToText(acceptedDoc(done)), "They would recieve the news soon.");
});

check("accepting and rejecting an addition", () => {
  assert.equal(proseToText(baseDoc(resolveSuggestion(proofed, "a1", true))), "They would recieve the news soon.");
  assert.equal(proseToText(acceptedDoc(resolveSuggestion(proofed, "a1", false))), "They would receive the news.");
});

check("suggestions are listed once each, in reading order, by kind", () => {
  const listed = suggestionsIn(proofed);
  assert.deepEqual(
    listed.map((s) => [s.id, s.kind, s.removed, s.added]),
    [
      ["r1", "replace", "recieve", "receive"],
      ["a1", "add", "", " soon"],
    ],
  );
});

check("two suggestions side by side stay two", () => {
  const touching = para(text("one", ins("x")), text("two", ins("y")));
  const listed = suggestionsIn(asProseDoc(JSON.parse(JSON.stringify(touching)))!);
  assert.equal(listed.length, 2, "they must not fuse into one to be accepted together");
});

check("a suggestion keeps its identity through storage", () => {
  const stored = asProseDoc(JSON.parse(JSON.stringify(proofed)))!;
  assert.deepEqual(suggestionsIn(stored), suggestionsIn(proofed));
});

check("a suggestion mark with no id is kept as plain text, not lost", () => {
  const odd = asProseDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "kept", marks: [{ type: "ins" }] }] }] })!;
  assert.equal(proseToText(baseDoc(odd)), "kept");
  assert.equal(hasSuggestions(odd), false);
});

check("Find lands on suggested words and the words they replace", () => {
  assert.equal(occurrencesIn(proofed, "receive", false).length, 1, "the suggested word");
  assert.equal(occurrencesIn(proofed, "recieve", false).length, 1, "the struck word");
  assert.equal(occurrencesIn(proofed, "soon", false).length, 1, "a suggested addition");
});

check("Replace leaves a section with pending suggestions alone", () => {
  const { doc, replaced, held } = replaceInDoc(proofed, "news", "word", false, "all");
  assert.equal(replaced, 0);
  assert.equal(held, true);
  assert.equal(doc, proofed);
});

console.log("\nbreaks and emphasis");

const at = "2026-09-19T10:00:00Z";
const two = (first: ProseText[], second: ProseText[], second_attrs: object): ProseDoc => ({
  type: "doc",
  content: [
    { type: "paragraph", content: first },
    { type: "paragraph", content: second, ...second_attrs },
  ],
});

/** Enter pressed mid-sentence while proofreading. */
const split = two([text("The tide went out ")], [text("and the causeway lay bare.")], { split: { id: "s1", at } });

check("a suggested break has not split the manuscript", () => {
  assert.equal(proseToText(baseDoc(split)), "The tide went out and the causeway lay bare.");
  assert.equal(extractText(split), "The tide went out and the causeway lay bare.");
});

check("accepting a break keeps it; rejecting puts the sentence back together", () => {
  assert.equal(resolveSuggestion(split, "s1", true).content.length, 2);
  assert.equal(proseToText(resolveSuggestion(split, "s1", false)), "The tide went out and the causeway lay bare.");
});

/** Backspace at the start of a paragraph while proofreading. */
const join = two([text("She turned.")], [text("He waited.")], { join: { id: "j1", at } });

check("a break proposed for removal still stands until accepted", () => {
  assert.equal(proseToText(baseDoc(join)), "She turned.\n\nHe waited.");
  assert.equal(extractText(join), "She turned.\n\nHe waited.");
  assert.equal(proseToText(resolveSuggestion(join, "j1", true)), "She turned.He waited.");
  assert.equal(proseToText(resolveSuggestion(join, "j1", false)), "She turned.\n\nHe waited.");
});

check("words typed across a new break are one suggestion", () => {
  const typed = two(
    [text("Boudicca looked at me."), text(" Hello", ins("t1"))],
    [text("World", ins("t1"))],
    { split: { id: "t1", at } },
  );
  const listed = suggestionsIn(typed);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.added, " Hello¶World");
  assert.equal(proseToText(baseDoc(typed)), "Boudicca looked at me.");
  assert.equal(proseToText(resolveSuggestion(typed, "t1", false)), "Boudicca looked at me.");
  assert.equal(resolveSuggestion(typed, "t1", true).content.length, 2);
});

const plain = para(text("They would receive the news."));

check("emphasis changed while proofreading is a suggestion, and does not reach the export", () => {
  // As if Italic had been clicked with "receive" selected.
  const italic = para(text("They would "), text("receive", { type: "em" }), text(" the news."));
  const proposed = proposeFormatting(plain, italic, { id: "f1", at });
  const listed = suggestionsIn(proposed);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.kind, "format");
  assert.deepEqual(listed[0]!.format, { added: ["em"], removed: [] });
  // As it stands, nothing is italic.
  assert.equal(baseDoc(proposed).content[0]!.content!.length, 1);
  // Accepted, it is; rejected, it is not.
  assert.deepEqual(resolveSuggestion(proposed, "f1", true).content[0]!.content![1]!.marks, [{ type: "em" }]);
  assert.equal(resolveSuggestion(proposed, "f1", false).content[0]!.content!.length, 1);
});

check("formatting back to the original takes the suggestion away", () => {
  const italic = para(text("They would "), text("receive", { type: "em" }), text(" the news."));
  const proposed = proposeFormatting(plain, italic, { id: "f1", at });
  const undone = proposeFormatting(proposed, plain, { id: "f2", at });
  assert.equal(hasSuggestions(undone), false);
});

check("formatting a suggested insertion just formats it", () => {
  const withIns = para(text("They would "), text("never", ins("n1")), text(" go."));
  const bolded = para(text("They would "), text("never", ins("n1"), { type: "strong" }), text(" go."));
  const out = proposeFormatting(withIns, bolded, { id: "f3", at });
  assert.equal(suggestionsIn(out).length, 1, "still only the insertion");
  assert.equal(suggestionsIn(out)[0]!.kind, "add");
});

check("formatting that changed the words is refused rather than let through", () => {
  const other = para(text("Something else entirely."));
  assert.equal(proposeFormatting(plain, other, { id: "f4", at }), plain);
});

check("breaks and emphasis keep their identity through storage", () => {
  const italic = para(text("They would "), text("receive", { type: "em" }), text(" the news."));
  const proposed = proposeFormatting(plain, italic, { id: "f1", at });
  for (const doc of [split, join, proposed]) {
    const stored = asProseDoc(JSON.parse(JSON.stringify(doc)))!;
    assert.deepEqual(suggestionsIn(stored), suggestionsIn(doc));
  }
});

console.log(`\n${passed} passed`);
