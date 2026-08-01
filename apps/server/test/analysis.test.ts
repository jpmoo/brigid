/**
 * The parts of the reading and the judging that don't need a model.
 *
 * Everything here is the machinery around the model — how a context window is
 * found, how a long chapter is split, how two readings of one section are
 * joined, who is worth judging, and the rules the reference documents impose
 * that a prompt alone cannot enforce. These are the places where a quiet bug
 * would poison every finding downstream without anything looking wrong.
 */
import type { CharacterAnalysis, PlacedDigest } from "@brigid/shared";
import { charBudget, contextLengthFrom } from "../src/ollama/client.js";
import { mergeDigests, normalize, splitForBudget } from "../src/ollama/digest.js";
import { buildRoster, dossierFor, reconcilePrimacy, timelineFor } from "../src/ollama/analysis.js";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

console.log("\nfinding the context window");

// Ollama prefixes the key with the architecture, so the architecture is not
// worth enumerating — any key ending in .context_length is the one.
check(
  "a llama model's window is found",
  contextLengthFrom({ model_info: { "llama.context_length": 131072, "llama.block_count": 32 } }) ===
    131072,
);
check(
  "so is a qwen one, under a different prefix",
  contextLengthFrom({ model_info: { "qwen2.context_length": 32768 } }) === 32768,
);
check(
  "a declared num_ctx parameter is the fallback",
  contextLengthFrom({ parameters: "stop  <|im_end|>\nnum_ctx  8192\n" }) === 8192,
);
check("a model that won't say gets null", contextLengthFrom({ model_info: {} }) === null);
check("and null is not mistaken for zero", contextLengthFrom({}) === null);

// The budget has to leave room for the answer, and be pessimistic about
// tokenization: being wrong upward costs a needless split, being wrong downward
// costs silent truncation of the chapter.
check("a large window yields a large budget", charBudget(131072) > 300_000);
check("the budget leaves room for the answer", charBudget(8192) < 8192 * 3);
check("a tiny window still returns something usable", charBudget(512) >= 2000);

console.log("\nsplitting a section that won't fit");

const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of the chapter.`).join("\n\n");
const parts = splitForBudget(long, 200);
check("a long section is split", parts.length > 1);
check("every part is within budget", parts.every((p) => p.length <= 200));
check(
  "and nothing is lost in the splitting",
  parts.join("\n\n").replace(/\s+/g, " ") === long.replace(/\s+/g, " "),
  `${parts.join("").length} vs ${long.length}`,
);
check("a section that fits is not split", splitForBudget("short enough", 200).length === 1);

// A single paragraph longer than the whole budget still has to go somewhere.
const monolith = "x".repeat(500);
check("an over-long paragraph is cut rather than dropped", splitForBudget(monolith, 200).length === 3);

console.log("\njoining two readings of one section");

const merged = mergeDigests([
  {
    characters: [{ name: "Ines", actions: ["opens the observatory"], aliases: ["the keeper"] }],
    events: [{ what: "the door is unlocked" }],
    summary: "First half.",
  },
  {
    characters: [
      { name: "ines", actions: ["climbs to the lens"], wants: ["to see the transit"] },
      { name: "Auden", actions: ["waits below"] },
    ],
    events: [{ what: "the transit begins" }],
    summary: "Second half.",
  },
]);

check("a character seen in both halves is one character", merged.characters.length === 2);
const ines = merged.characters.find((c) => c.name.toLowerCase() === "ines");
check("and their actions are pooled", ines?.actions.length === 2);
check("aliases survive the join", ines?.aliases?.includes("the keeper") === true);
check("wants recorded in only one half survive too", ines?.wants?.includes("to see the transit") === true);
check("events keep their order", merged.events.map((e) => e.what).join("|") === "the door is unlocked|the transit begins");

console.log("\nrefusing nonsense from the model");

const cleaned = normalize({
  characters: [
    { name: "  Ines  ", actions: ["  opens the door  ", "", "   "] },
    { name: "   ", actions: ["ghost"] },
    // @ts-expect-error deliberately malformed, which is the point
    null,
  ],
  // @ts-expect-error deliberately malformed
  events: [{ what: "something happens" }, { what: "" }, { nope: true }],
  summary: "  ",
});
check("a nameless character is dropped", cleaned.characters.length === 1);
check("names and actions are trimmed", cleaned.characters[0]!.name === "Ines");
check("blank actions are dropped", cleaned.characters[0]!.actions.length === 1);
check("an event with no text is dropped", cleaned.events.length === 1);
check("a blank summary is not stored as one", cleaned.summary === undefined);

console.log("\nwho is worth judging");

function section(start: number, end: number, characters: PlacedDigest["characters"]): PlacedDigest {
  return { blockId: `b${start}`, label: null, start, end, words: 1000, characters, events: [] };
}

const roster = buildRoster([
  section(0, 0.5, [
    { name: "Ines", actions: ["a", "b", "c", "d"], aliases: ["the keeper"] },
    { name: "Auden", actions: ["x"] },
    { name: "A porter", actions: ["carries a trunk"] },
  ]),
  section(0.5, 1, [
    { name: "the keeper", actions: ["e", "f", "g"] },
    { name: "Auden", actions: ["y"] },
  ]),
]);

const rIines = roster.find((r) => r.name === "Ines");
check("an alias used later resolves to the same person", rIines?.actions === 7, `got ${rIines?.actions}`);
check("and the roster doesn't double them", roster.filter((r) => r.name === "Ines").length === 1);
check("someone with plenty on the page is judgeable", rIines?.judgeable === true);
check("their span covers the book", rIines?.span.first === 0 && rIines?.span.last === 1);

// The rubric requires citable events for every score of 2 or higher, so a
// character with two actions can only produce noughts and ones. Spending a
// model on that reaches a conclusion already known.
const auden = roster.find((r) => r.name === "Auden");
check("two actions across two sections is not enough", auden?.judgeable === false);
check("and the reason says so plainly", (auden?.reason ?? "").includes("2 recorded actions"));

const porter = roster.find((r) => r.name === "A porter");
check("someone in a single section is not judgeable", porter?.judgeable === false);
check("with a different reason", (porter?.reason ?? "").includes("only one section"));

console.log("\nwhat the judge is shown");

const placed = [
  section(0, 0.25, [{ name: "Ines", actions: ["opens the observatory"], wants: ["the transit"] }]),
  section(0.75, 1, [{ name: "Ines", actions: ["closes it for good"] }]),
];
placed[0]!.events = [{ what: "the door is unlocked", kind: "decision", weight: "notable" }];

const timeline = timelineFor(placed);
// Positions are the whole reason the digest exists in this shape: five of the
// seven structure models make proportional claims and the reference document
// refuses a mapping that has to drag a beat to make itself work.
check("the timeline carries positions", timeline.includes("[0–25%]") && timeline.includes("[75–100%]"));
check("and the kind of turn", timeline.includes("(decision, notable)"));

const dossier = dossierFor(placed, "Ines");
check("a dossier gathers one character across the book", dossier.includes("opens the observatory") && dossier.includes("closes it for good"));
check("with positions attached to each", dossier.includes("[0–25%]"));
check("an unknown name yields nothing rather than everything", dossierFor(placed, "Nobody") === "");

console.log("\nthe primacy rule");

/**
 * The rubric says only one character ordinarily carries a 5 on an axis, and
 * that if two seem to, one is usually a 4. Characters are judged one at a time
 * and cannot see each other's scores, so the rule cannot live in the prompt.
 */
function profile(name: string, score: number, aligned: string[]): CharacterAnalysis {
  return {
    name,
    focal: "Ines",
    axes: [{ axis: "shadow", score, aligned, contradictory: [] }],
    epithet: "",
    summary: "",
    phaseShifts: [],
    confidence: "",
  };
}

const settled = reconcilePrimacy([
  profile("Auden", 5, ["one citation"]),
  profile("Vane", 5, ["a", "b", "c"]),
  profile("Ines", 3, []),
]);
const scoreOf = (n: string) => settled.find((p) => p.name === n)!.axes[0]!.score;
check("the better-evidenced claim keeps the 5", scoreOf("Vane") === 5);
check("the weaker one steps down to 4", scoreOf("Auden") === 4);
check("and scores below 5 are left alone", scoreOf("Ines") === 3);

const single = reconcilePrimacy([profile("Vane", 5, ["a"])]);
check("an uncontested 5 stands", single[0]!.axes[0]!.score === 5);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
