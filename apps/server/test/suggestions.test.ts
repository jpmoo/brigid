import assert from "node:assert/strict";
import {
  acceptedDoc,
  asProseDoc,
  baseDoc,
  countWords,
  hasSuggestions,
  occurrencesIn,
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

check("Find counts the text as it stands", () => {
  // "receive" is only suggested; "recieve" is still there.
  assert.equal(occurrencesIn(proofed, "receive", false).length, 0);
  assert.equal(occurrencesIn(proofed, "recieve", false).length, 1);
});

check("Replace leaves a section with pending suggestions alone", () => {
  const { doc, replaced, held } = replaceInDoc(proofed, "news", "word", false, "all");
  assert.equal(replaced, 0);
  assert.equal(held, true);
  assert.equal(doc, proofed);
});

console.log(`\n${passed} passed`);
