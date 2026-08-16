import assert from "node:assert/strict";
import {
  REFERENCE_WORKS,
  resemblance,
  baselines,
  deviations,
  leastCharacteristic,
  measure,
  mostCharacteristic,
  splitSpeech,
  tokens,
  featureLabel,
  RELIABLE_WORDS,
} from "@brigid/shared";
import type { StyleSample } from "@brigid/shared";

/**
 * The fingerprint, and what is done with it.
 *
 * All arithmetic, so all of it can be checked without a model, a browser or a
 * database — which is the reason for measuring rather than judging in the first
 * place. A model's opinion of a passage cannot be asserted against; a mean
 * sentence length can.
 */

let failures = 0;
function test(name: string, run: () => void): void {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${(err as Error).message.split("\n").join("\n      ")}`);
  }
}

console.log("splitting speech from narration");

test("what is quoted is speech and what is not is narration", () => {
  const { spoken, narrated } = splitSpeech(
    `He put the cup down. "I told you it would rain," he said. She said nothing.`,
  );
  assert.equal(spoken.trim(), "I told you it would rain,");
  assert.ok(narrated.includes("He put the cup down."));
  assert.ok(narrated.includes("he said."));
  assert.ok(!narrated.includes("I told you"));
});

test("typeset quotes count as readily as straight ones", () => {
  const { spoken } = splitSpeech(`“Come in,” she said.`);
  assert.equal(spoken.trim(), "Come in,");
});

/**
 * An apostrophe is the same character as a single quote, so treating single
 * quotes as speech would have "don't" open a quotation that never closes and
 * swallow the rest of the section into dialogue.
 */
test("an apostrophe does not open a quotation", () => {
  const { spoken, narrated } = splitSpeech(
    `He didn't move. It wasn't the cold that stopped him, and it wasn't fear.`,
  );
  assert.equal(spoken, "");
  assert.ok(narrated.includes("wasn't fear"));
});

test("an unclosed quotation gives its words back to narration", () => {
  const { spoken, narrated } = splitSpeech(`She said "wait and the rest of it ran on.`);
  assert.equal(spoken, "");
  assert.ok(narrated.includes("the rest of it ran on"));
});

console.log("\nmeasuring a section");

const PLAIN =
  "The frost held all morning. He walked to the wall and back again, counting " +
  "the stones as he went. There was nothing else to do. The light came late " +
  "and went early, and between the two of them he did what work there was.";

test("a section reports what it is made of", () => {
  const m = measure(PLAIN);
  assert.equal(m.words, tokens(PLAIN).length);
  assert.equal(m.sentences, 4);
  assert.equal(m.paragraphs, 1);
  assert.equal(m.dialogueShare, 0);
});

test("dialogue share is the share of words spoken", () => {
  const m = measure(`"Come here," he said. "Now."`);
  assert.ok(m.dialogueShare > 0.5, `spoken share was ${m.dialogueShare}`);
  assert.ok(m.dialogueShare < 1);
});

test("the streams are measured apart", () => {
  const m = measure(
    `"Yeah. Dunno. Maybe," he said, and the long slow afternoon went on ` +
      `about them, indifferent to the question and to the answer both.`,
  );
  // Terse speech, unhurried narration: the two should not report the same
  // sentence length, which is the whole reason for holding them apart.
  assert.ok(
    m.narration["sent.mean"]! > m.dialogue["sent.mean"]!,
    `narration ${m.narration["sent.mean"]} vs dialogue ${m.dialogue["sent.mean"]}`,
  );
});

test("rates are per something, so length does not change them", () => {
  const once = measure(PLAIN);
  const thrice = measure(`${PLAIN}\n\n${PLAIN}\n\n${PLAIN}`);
  // Three copies of the same prose is the same prose.
  for (const key of ["sent.mean", "lex.wordlen", "fw.the", "punct.comma"]) {
    const a = once.overall[key]!;
    const b = thrice.overall[key]!;
    assert.ok(
      Math.abs(a - b) < Math.max(0.5, Math.abs(a) * 0.1),
      `${key}: ${a} once, ${b} three times`,
    );
  }
});

test("an empty section measures nothing rather than dividing by nothing", () => {
  const m = measure("   ");
  assert.equal(m.words, 0);
  for (const value of Object.values(m.overall)) assert.ok(Number.isFinite(value));
});

test("every feature is a finite number", () => {
  for (const text of [PLAIN, `"Hi."`, "One.", "—", "Word"]) {
    const m = measure(text);
    for (const stream of ["overall", "narration", "dialogue"] as const) {
      for (const [key, value] of Object.entries(m[stream])) {
        assert.ok(Number.isFinite(value), `${stream}.${key} was ${value} for ${JSON.stringify(text)}`);
      }
    }
  }
});

test("every feature a report can name has a name", () => {
  const m = measure(PLAIN);
  for (const key of Object.keys(m.overall)) {
    assert.notEqual(featureLabel(key), key, `${key} has no plain-English label`);
  }
});

test("paragraphs are found however the line endings were written", () => {
  const unix = "One paragraph here.\n\nAnd a second one.\n\nAnd a third.";
  const windows = unix.replace(/\n/g, "\r\n");
  assert.equal(measure(unix).paragraphs, 3);
  assert.equal(
    measure(windows).paragraphs,
    3,
    "a blank line is two newlines here and \\r\\n\\r\\n anywhere Windows has been",
  );
  assert.equal(measure(windows).overall["para.words"], measure(unix).overall["para.words"]);
});

console.log("\nthe writer's normal");

/** Prose in one hand: long sentences, commas, no dialogue. */
function longWinded(seed: number): string {
  const clauses = [
    "the road went on past the mill and the mill pond",
    "there was a light in the upper window of the house",
    "he thought about the letter and about what it had not said",
    "the year turned over quietly and without any sign of it",
    "she waited for the sound of the gate and heard nothing",
  ];
  const out: string[] = [];
  // Long enough to be a real section. The thresholds these are checked against
  // are the ones that stop a short scene being called deviant on noise alone,
  // so a fixture below them would be testing nothing.
  for (let i = 0; i < 44; i += 1) {
    const a = clauses[(seed + i) % clauses.length]!;
    const b = clauses[(seed + i + 2) % clauses.length]!;
    out.push(`In those days ${a}, and ${b}, and that was the whole of it.`);
  }
  return out.join(" ");
}

/** Prose in another: clipped, hard stops, no subordination. */
function clipped(seed: number): string {
  const bits = ["He ran.", "Rain.", "Nothing moved.", "She waited.", "It stopped.", "Dark now."];
  const out: string[] = [];
  for (let i = 0; i < 640; i += 1) out.push(bits[(seed + i) % bits.length]!);
  return out.join(" ");
}

const sample = (
  id: string,
  text: string,
  opts: { included?: boolean; voice?: string | null } = {},
): StyleSample => ({
  blockId: id,
  voice: opts.voice ?? null,
  included: opts.included ?? true,
  measurement: measure(text),
});

test("a baseline is the average of what was included", () => {
  const samples = [sample("a", longWinded(0)), sample("b", longWinded(1)), sample("c", longWinded(2))];
  const built = baselines(samples);
  const book = built.get(null)!;
  assert.equal(book.sections, 3);
  assert.ok(book.overall["sent.mean"]!.mean > 12, "long-winded prose has long sentences");
});

test("an excluded section does not move the baseline", () => {
  const steady = [sample("a", longWinded(0)), sample("b", longWinded(1)), sample("c", longWinded(2))];
  const withDraft = [...steady, sample("draft", clipped(0), { included: false })];

  const before = baselines(steady).get(null)!.overall["sent.mean"]!.mean;
  const after = baselines(withDraft).get(null)!.overall["sent.mean"]!.mean;
  assert.equal(after, before, "the draft was kept out of the average");
});

test("but it is still measured, so it can be asked about", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("draft", clipped(0), { included: false }),
  ];
  const found = deviations(samples, baselines(samples));
  const draft = found.find((d) => d.blockId === "draft");
  assert.ok(draft, "the excluded section was still placed against the normal");
  assert.ok(draft!.delta > 0);
});

test("the baseline is weighted by words, not by sections", () => {
  // One long section and one short one in different hands. Averaged per
  // section the two would count equally; averaged per word the long one
  // dominates, which is what "this writer's normal" means.
  const long = sample("long", longWinded(0).repeat(4));
  const short = sample("short", clipped(0).split(" ").slice(0, 30).join(" "));
  const book = baselines([long, short]).get(null)!;
  const longAlone = baselines([long]).get(null)!;
  const gap = Math.abs(book.overall["sent.mean"]!.mean - longAlone.overall["sent.mean"]!.mean);
  assert.ok(gap < 3, `the short section barely moved the mean, off by ${gap.toFixed(2)}`);
});

console.log("\nhow far a section sits from it");

test("a section in the same hand sits close to the middle", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("d", longWinded(3)),
  ];
  const found = deviations(samples, baselines(samples));
  for (const d of found) {
    assert.ok(d.delta < 1.5, `${d.blockId} sat ${d.delta.toFixed(2)} away from its own kind`);
  }
});

test("a section in another hand sits a long way out", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("odd", clipped(0)),
  ];
  const found = deviations(samples, baselines(samples));
  const odd = found.find((d) => d.blockId === "odd")!;
  const rest = found.filter((d) => d.blockId !== "odd");
  for (const d of rest) {
    assert.ok(
      odd.delta > d.delta,
      `the clipped section (${odd.delta.toFixed(2)}) should sit further out than ${d.blockId} (${d.delta.toFixed(2)})`,
    );
  }
});

test("and it says which features moved, not merely that something did", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("odd", clipped(0)),
  ];
  const odd = deviations(samples, baselines(samples)).find((d) => d.blockId === "odd")!;
  assert.ok(odd.moved.length > 0);
  const named = odd.moved.map((m) => m.key.replace(/^\w+:/, ""));
  assert.ok(
    named.includes("sent.mean") || named.includes("rhythm.syllPerSent") || named.includes("sent.per1k"),
    `expected sentence length among the movers, got ${named.slice(0, 6).join(", ")}`,
  );
  // Each carries what it was and what it should have been, so a report can say
  // so rather than only that a number was unusual.
  for (const m of odd.moved) {
    assert.ok(Number.isFinite(m.z) && Number.isFinite(m.value) && Number.isFinite(m.mean));
  }
});

/**
 * Dividing by a spread of zero is how stylometry produces its most confident
 * nonsense: every section uses one semicolon per thousand words, this one uses
 * two, therefore it is a hundred standard deviations from normal.
 */
/**
 * The one that mattered. A section left inside its own baseline drags the mean
 * towards itself and inflates the spread by exactly the amount it differs, so
 * the more unusual it is the higher it raises the bar it is judged against.
 * Every section then comes out about the same distance from normal however
 * differently it is written — a broken measurement that looks like a working
 * one.
 */
test("a section is never part of the normal it is measured against", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("odd", clipped(0)),
  ];
  const found = deviations(samples, baselines(samples));
  const odd = found.find((d) => d.blockId === "odd")!;

  // Left in its own average, an outlier among four sections cannot exceed
  // about two standard deviations on any feature however far out it is.
  const furthest = Math.max(...odd.moved.map((m) => Math.abs(m.z)));
  assert.ok(furthest > 3, `the furthest feature reached only ${furthest.toFixed(2)}`);

  // And the distances are not all the same number, which is what a section
  // measured against itself produces.
  const distinct = new Set(odd.moved.map((m) => Math.abs(m.z).toFixed(2)));
  assert.ok(distinct.size > 2, `every feature moved by the same amount: ${[...distinct]}`);
});

test("a feature nobody varies cannot make a section look strange", () => {
  const same = "He went. She went. They went. It went.";
  const samples = [sample("a", same), sample("b", same), sample("c", same), sample("d", same)];
  const found = deviations(samples, baselines(samples));
  for (const d of found) {
    assert.ok(Number.isFinite(d.delta), `delta was ${d.delta}`);
    assert.ok(d.delta < 1, `identical prose sat ${d.delta} from itself`);
  }
});

test("a short section is measured but never called unusual", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("tiny", "He left."),
  ];
  const found = deviations(samples, baselines(samples));
  const tiny = found.find((d) => d.blockId === "tiny")!;
  assert.equal(tiny.reliable, false, "too short to draw a conclusion from");
  assert.ok(tiny.words < RELIABLE_WORDS);
  assert.ok(
    !leastCharacteristic(found, samples).some((d) => d.blockId === "tiny"),
    "and it is kept out of the flagged list",
  );
});

console.log("\nvoices");

test("a voice with enough behind it gets its own normal", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("l1", clipped(0), { voice: "letters" }),
    sample("l2", clipped(1), { voice: "letters" }),
    sample("l3", clipped(2), { voice: "letters" }),
  ];
  const built = baselines(samples);
  assert.ok(built.has("letters"), "the letters were averaged among themselves");

  const found = deviations(samples, built);
  const letter = found.find((d) => d.blockId === "l1")!;
  assert.equal(letter.against, "letters");

  // Measured against its own kind it is ordinary; against the book it would be
  // the most deviant thing in it.
  const againstBook = deviations(
    samples.map((s) => ({ ...s, voice: null })),
    baselines(samples.map((s) => ({ ...s, voice: null }))),
  ).find((d) => d.blockId === "l1")!;
  assert.ok(
    letter.delta < againstBook.delta,
    `own voice ${letter.delta.toFixed(2)} should be closer than the book's ${againstBook.delta.toFixed(2)}`,
  );
});

test("two examples are not yet a voice", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("l1", clipped(0), { voice: "letters" }),
    sample("l2", clipped(1), { voice: "letters" }),
  ];
  const built = baselines(samples);
  assert.ok(!built.has("letters"), "too little of it to have a normal of its own");
  const letter = deviations(samples, built).find((d) => d.blockId === "l1")!;
  assert.equal(letter.against, null, "so it falls back to the book's, which is honest");
});

console.log("\ncharacteristic, which is not the same as good");

test("the most characteristic sections are the ones nearest the middle", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("odd", clipped(0)),
  ];
  const found = deviations(samples, baselines(samples));
  const typical = mostCharacteristic(found, samples, 3);
  assert.ok(!typical.includes("odd"), "the odd one out is not what this writer sounds like");
  assert.equal(typical.length, 3);
});

test("an excluded section is never held up as characteristic", () => {
  const samples = [
    sample("a", longWinded(0)),
    sample("b", longWinded(1)),
    sample("c", longWinded(2)),
    sample("draft", longWinded(0), { included: false }),
  ];
  const found = deviations(samples, baselines(samples));
  assert.ok(!mostCharacteristic(found, samples).includes("draft"));
});

console.log("\nmeasuring against books that were measured");

test("every reference work is nearest to itself", () => {
  // The one property the metric cannot be allowed to get wrong. If a book is
  // not its own closest match, the distance is not measuring what it claims to.
  for (const work of REFERENCE_WORKS.slice(0, 12)) {
    const nearest = resemblance(work.features)[0]!;
    assert.equal(
      `${nearest.work.author}|${nearest.work.title}`,
      `${work.author}|${work.title}`,
      `${work.title} was nearest to ${nearest.work.title}`,
    );
    assert.ok(nearest.distance < 1e-9, `and at zero distance, not ${nearest.distance}`);
  }
});

test("the ornate books group together and away from the clipped ones", () => {
  const melville = REFERENCE_WORKS.find((w) => w.title === "Moby-Dick")!;
  const ranked = resemblance(melville.features);
  const furthest = ranked.at(-1)!;
  // Hemingway is the far end of this axis by any reading, and the arithmetic
  // should find that without being told.
  assert.ok(
    /Hemingway|Christie|Carroll|Baum/.test(furthest.work.author + furthest.work.title),
    `Moby-Dick measured furthest from ${furthest.work.author} — ${furthest.work.title}`,
  );
});

test("a resemblance says where the two are apart, not only how far", () => {
  const hemingway = REFERENCE_WORKS.find((w) => w.author.includes("Hemingway"))!;
  const against = resemblance(hemingway.features).find((r) => r.work.title === "Moby-Dick")!;
  assert.ok(against.apart.length > 0);
  for (const gap of against.apart) {
    assert.ok(Number.isFinite(gap.gap) && gap.label.length > 0);
  }
});

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
