import { measure } from "@brigid/shared";
import type { ProseDna } from "../../../api.js";

/**
 * Prose the model wrote, measured against the writer's own.
 *
 * This is the whole point of measuring rather than judging. The model was given
 * a description of a voice and two passages of it and asked to imitate them;
 * whether it managed is not something it can be asked, and not something a
 * reader can tell at a glance. The same arithmetic that produced the fingerprint
 * runs over the answer in a millisecond and says how close it landed.
 *
 * Shared between the panel that shows the figures and the loop that decides
 * whether to ask again, because those two must never disagree about what
 * counts as a miss.
 *
 * What it cannot say is whether the passage is any good. It reports distance
 * from a habit, and a writer's own best page would often measure as a departure.
 */

const SHOWN = [
  { feature: "sent.mean", label: "words per sentence", round: 1, percent: false },
  /**
   * The range, not just the average — and the one most worth watching.
   *
   * A model asked to write like someone who mixes four-word sentences with
   * fifty-word ones returns the average and loses the swing: everything lands
   * near the mean, the long sentences vanish, and the subordination that filled
   * them goes with them. Every other figure can match while the passage reads
   * nothing like the writer, because sameness is what was added and no average
   * can show it.
   */
  { feature: "sent.sd", label: "how much that varies", round: 1, percent: false },
  { feature: "sent.long", label: "long sentences", round: 0, percent: true },
  { feature: "punct.comma", label: "commas per sentence", round: 2, percent: false },
  /**
   * A mark the writer never uses is the one an imitation reaches for.
   *
   * Told to add subordination and told nothing about what to leave alone, a
   * rewrite came back at 3.9 semicolons per thousand words for a writer whose
   * prose contains none at all. Nothing else here would have caught it — the
   * sentences were the right length and varied by the right amount — and the
   * passage still announced itself on sight.
   */
  { feature: "punct.semicolon", label: "semicolons per 1,000", round: 1, percent: false },
  { feature: "para.words", label: "words per paragraph", round: 0, percent: false },
  { feature: "mod.adverb", label: "-ly adverbs per 1,000", round: 1, percent: false },
] as const;

export interface Row {
  feature: string;
  label: string;
  got: number;
  want: number;
  round: number;
  percent: boolean;
  off: boolean;
}

/**
 * Far enough from the writer to be worth saying so.
 *
 * Against their own variation between sections, not a percentage picked from
 * the air: a writer whose sections run from 12 to 15 words a sentence and one
 * whose sections run from 4 to 30 have not both departed when a passage comes
 * back at 6.
 *
 * The floor matters as much as the multiplier. A figure that barely moves
 * between sections has a spread near zero, and without a floor every draft
 * would be flagged for missing it by a rounding error. A figure that is
 * genuinely zero throughout — a mark the writer never once uses — keeps only
 * the tiny floor, which is what makes its appearance a departure rather than a
 * rounding error.
 */
const OFF = 2;
function departed(got: number, want: number, spread: number): boolean {
  const room = Math.max(spread, Math.abs(want) * 0.15, 1e-6);
  return Math.abs(got - want) / room > OFF;
}

/** Below this the measurements are noise, and a comparison is worse than none. */
export const MEASURABLE_WORDS = 120;

/**
 * The passage as paragraphs, by the same rule the reader's copy is drawn with.
 *
 * A blank line is what separates paragraphs in the manuscript and what the
 * model is told to use. A model that forgets and puts single breaks between
 * them has still written paragraphs, and the panel draws them as such — but the
 * measurement split on blank lines only, so it saw one paragraph where the
 * reader saw forty-eight. It reported 385 words a paragraph for a passage of
 * eight-word paragraphs, the re-ask passed that figure on as a fault to fix,
 * and the next draft was written to correct something that was never there.
 *
 * Displayed and measured the same way now. A number about the passage has to
 * be a number about the passage the writer is looking at.
 */
export function paragraphsOf(prose: string): string[] {
  const blank = prose.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (blank.length > 1) return blank;
  return prose.split(/\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Things that are simply wrong, as opposed to unlike the writer.
 *
 * The measurements answer "how near is this to how you write", and every one of
 * them is arguable — a writer's best page often measures as a departure. These
 * do not answer that. Dialogue without quotation marks is not a stylistic
 * choice the model made, and a scene whose paragraphs are separated by single
 * line breaks is not a paragraphing decision; both are the model losing hold of
 * instructions it was given plainly, and both were happening while the panel
 * reported only that some averages were a little off.
 *
 * Kept apart from the rows for that reason. A fault is a fact, and it should
 * not have to compete for attention with a number that might be fine.
 */
function faultsIn(prose: string, dna: ProseDna): string[] {
  const found: string[] = [];

  // The writer speaks on the page but this passage never opens a quotation.
  if (dna.dialogueShare > 0.02 && !/["“]/.test(prose)) {
    found.push("No dialogue is in quotation marks, and your prose uses them.");
  }

  // A speech tag after a full stop inside the quote: "Wait." She said.
  const tag = prose.match(/[.!?]["”]\s+(He|She|They|I|We|It)\s+(said|asked|replied|answered|shouted|whispered)\b/);
  if (tag) {
    found.push(`Speech tags are punctuated wrongly — ${tag[0].trim()} should take a comma and a lowercase tag.`);
  }

  // Paragraphs marked by single breaks. The manuscript uses blank lines, and a
  // passage set this way measures as one enormous paragraph.
  const singles = prose.split(/\n/).filter((l) => l.trim()).length;
  const blanks = prose.split(/\n\s*\n/).filter((p) => p.trim()).length;
  if (singles > 2 && blanks < singles / 2) {
    found.push("Paragraphs are separated by single line breaks rather than blank lines.");
  }

  return found;
}

export interface Check {
  words: number;
  rows: Row[];
  faults: string[];
  /**
   * Too short to measure, which is itself the news.
   *
   * The rates below this length are noise, so nothing was reported — and the
   * panel went silent exactly when a section rewrite came back as thirty words
   * and a full stop. Hiding the measurements was right; hiding the fact that
   * there was nothing to measure was not, and it took the button to ask again
   * with it. A stub is the loudest thing a draft can be.
   */
  tooShort: boolean;
}

export function checkDraft(prose: string, dna: ProseDna | null): Check | null {
  if (!dna) return null;
  const words = prose.trim().split(/\s+/).filter(Boolean).length;
  if (words < MEASURABLE_WORDS) {
    return { words, rows: [], faults: faultsIn(prose, dna), tooShort: true };
  }

  const mine = measure(paragraphsOf(prose).join("\n\n"));
  const rows = SHOWN.map(({ feature, label, round, percent }) => {
    const want = dna.features[feature];
    const got = mine.overall[feature];
    if (want === undefined || got === undefined) return null;
    const row: Row = {
      feature,
      label,
      got,
      want,
      round,
      percent,
      off: departed(got, want, dna.spread?.[feature] ?? 0),
    };
    return row;
  }).filter((r): r is Row => r !== null);

  return { words, rows, faults: faultsIn(prose, dna), tooShort: false };
}

/** A figure as the writer reads it, share or rate. */
export function show(v: number, row: { round: number; percent: boolean }): string {
  return row.percent ? `${Math.round(v * 100)}%` : v.toFixed(row.round);
}

/**
 * What to tell the model it missed, and what it must not touch.
 *
 * Named and numbered, because "write it more like me" is what was asked the
 * first time and is what produced the draft being rejected.
 *
 * The second half is there because the first half alone caused its own damage.
 * Told only to add subordination, a rewrite reached for semicolons — a mark the
 * writer never uses — and overshot every figure it had been asked to raise.
 * Naming what already matched, and saying to land on the numbers rather than
 * past them, is the difference between a correction and a swing.
 */
export function retryNote(rows: Row[], faults: string[] = [], tooShort = false, words = 0): string {
  /**
   * Everything that missed, and everything that must not move.
   *
   * This was cut to a single instruction after a draft obeyed the easiest of
   * six demands and ignored the rest. That was the wrong lesson: the fuller
   * note produced real prose, and the short one produced a thirty-word stub and
   * then a copy of the writer's own notes. The competing-instructions theory was
   * measuring the wrong thing — what actually degraded was the context, filling
   * up with failed attempts, and shortening the note only removed what little
   * was still steering.
   *
   * So the list is back, and the attempts it used to argue with are gone from
   * the conversation instead.
   */
  const wrong = faults.length > 0 ? `${faults.join(" ")}\n\n` : "";
  const fmt = (r: Row) => `${r.label} came out at ${show(r.got, r)} against my usual ${show(r.want, r)}`;
  const missed = rows.filter((r) => r.off);
  const held = rows.filter((r) => !r.off);

  const keep =
    held.length > 0
      ? `\n\nLeave these alone — they already match me: ${held.map((r) => `${r.label} at ${show(r.want, r)}`).join("; ")}.`
      : "";

  const varies = missed.some((r) => r.feature === "sent.sd")
    ? " The range matters more than the average: write some sentences of thirty words and more, carrying subordinate clauses, and set them against the short ones. Make existing sentences longer by joining what belongs together rather than adding new ones."
    : "";

  return `Try that passage again, working from my notes and my request above. Write the whole scene — every event in my notes, in order, start to finish. Not a summary, not the closing lines.

${wrong}Keep the events, the order and the point of view. Dialogue goes in double quotation marks with a comma before the speech tag, a new speaker starts a new paragraph, and paragraphs are separated by a blank line.

Measured against my own sections, the last attempt missed: ${missed.map(fmt).join("; ")}.${keep}${varies}

These figures describe how I write; they are not targets to hit. Do not pad a sentence with description it does not need or append a simile to lengthen a clause. If the only way to reach a number is to write something I would not have written, write the better sentence and miss the number.`;
}
