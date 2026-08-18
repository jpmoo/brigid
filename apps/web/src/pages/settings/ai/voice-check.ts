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

export function checkDraft(prose: string, dna: ProseDna | null): { words: number; rows: Row[] } | null {
  if (!dna) return null;
  const words = prose.trim().split(/\s+/).filter(Boolean).length;
  if (words < MEASURABLE_WORDS) return null;

  const mine = measure(prose);
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

  return { words, rows };
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
export function retryNote(rows: Row[]): string {
  const missed = rows.filter((r) => r.off);
  const held = rows.filter((r) => !r.off);

  const keep =
    held.length > 0
      ? ` Leave these alone — they already match me, and moving them would make it worse: ${held
          .map((r) => `${r.label} at ${show(r.want, r)}`)
          .join("; ")}.`
      : "";

  return `Rewrite that passage. Keep the events, the order and the point of view exactly as they are — the problem is the prose, not the content. Measured against my own sections it missed: ${missed
    .map((r) => `${r.label} came out at ${show(r.got, r)} against my usual ${show(r.want, r)}`)
    .join("; ")}. Fix those specifically, and land on those figures rather than past them.${keep} If the sentence-length range is among them, vary the lengths far more — genuinely long sentences carrying subordinate clauses, set against short ones — but build them from commas and clauses, not from punctuation I do not otherwise use.`;
}
