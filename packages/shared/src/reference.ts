import { REFERENCE_WORKS as PUBLIC_DOMAIN } from "./reference-data.js";
import type { ReferenceWork } from "./reference-data.js";
import { LOCAL_WORKS } from "./reference-local.js";

/**
 * Everything a manuscript can be set beside, wherever it was measured from.
 *
 * The public-domain set leads, so the features it carries stay the ones that
 * define what is comparable — a locally measured book carrying a feature the
 * others lack would otherwise widen the comparison to a question most of the
 * set could not answer.
 *
 * Locally measured books count toward the spread as well as sitting in the
 * list. They are novels, measured by the same extractor, and holding them out
 * of the normalization would make the baseline mean something different from
 * what it says it means.
 */
const REFERENCE_WORKS: ReferenceWork[] = [...PUBLIC_DOMAIN, ...LOCAL_WORKS];
import { featureLabel } from "./style.js";
import type { StyleFeatures } from "./style.js";

export { REFERENCE_WORKS };
export type { ReferenceWork };

/**
 * Placing a manuscript among books that were actually measured.
 *
 * The four ranges this replaces were written down from general style guidance —
 * roughly right, entirely unbacked, and impossible for a writer to check. These
 * come from running the same extractor over the same kind of text, so "longer
 * sentences than usual" now means "longer than the thirty-two novels in the
 * set, and here is which ones".
 *
 * A comparison across features has to be normalized or it is nonsense: sentence
 * length is measured in words and semicolons per thousand, and subtracting one
 * from the other would let whichever happens to have larger numbers decide the
 * answer. Everything is turned into standard deviations across the reference
 * set first, which puts every measure on the same footing.
 */

/** The features every reference work carries, and so the ones worth comparing. */
export const COMPARABLE = Object.keys(REFERENCE_WORKS[0]?.features ?? {});

export interface Spread {
  mean: number;
  sd: number;
  min: number;
  max: number;
}

/** What the reference set does across each measure. */
export const REFERENCE_SPREAD: Record<string, Spread> = (() => {
  const out: Record<string, Spread> = {};
  for (const key of COMPARABLE) {
    const values = REFERENCE_WORKS.map((w) => w.features[key]).filter(
      (v): v is number => v !== undefined,
    );
    if (values.length === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
    );
    out[key] = { mean, sd, min: Math.min(...values), max: Math.max(...values) };
  }
  return out;
})();

/** A value in standard deviations across the reference set. */
export function standardize(key: string, value: number): number | null {
  const spread = REFERENCE_SPREAD[key];
  if (!spread || spread.sd <= 0) return null;
  return (value - spread.mean) / spread.sd;
}

/**
 * Where a value sits along the reference set's own range, from 0 to 1.
 *
 * For drawing rather than for arithmetic. Clamped a little outside the observed
 * range so a manuscript further out than any of the thirty-two still lands on
 * the track instead of falling off the end of it.
 */
export function place(key: string, value: number): number | null {
  const spread = REFERENCE_SPREAD[key];
  if (!spread) return null;
  const low = spread.min - (spread.max - spread.min) * 0.15;
  const high = spread.max + (spread.max - spread.min) * 0.15;
  if (high <= low) return 0.5;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

export interface Resemblance {
  work: ReferenceWork;
  /** Mean distance in standard deviations. Smaller is more alike. */
  distance: number;
  /** Where the two are furthest apart, largest gap first. */
  apart: {
    key: string;
    label: string;
    mine: number;
    theirs: number;
    /** Positive where the manuscript is the higher of the two. */
    gap: number;
  }[];
}

/**
 * How near a manuscript sits to each measured book.
 *
 * Every feature counts the same, having been standardized first. That is a
 * choice and worth naming: it means a book that matches on punctuation and
 * differs on sentence length scores the same as one the other way round. There
 * is no principled weighting available — nobody knows which of these a reader
 * notices most — so an unweighted mean is the honest option, and `apart` is
 * returned alongside so the number is never the whole answer.
 */
export function resemblance(mine: StyleFeatures): Resemblance[] {
  const out: Resemblance[] = [];

  for (const work of REFERENCE_WORKS) {
    const gaps: Resemblance["apart"] = [];
    let total = 0;
    let counted = 0;

    for (const key of COMPARABLE) {
      const value = mine[key];
      const theirs = work.features[key];
      if (value === undefined || theirs === undefined) continue;
      const a = standardize(key, value);
      const b = standardize(key, theirs);
      if (a === null || b === null) continue;

      total += Math.abs(a - b);
      counted += 1;
      gaps.push({
        key,
        label: featureLabel(key),
        mine: value,
        theirs,
        gap: a - b,
      });
    }

    if (counted === 0) continue;
    out.push({
      work,
      distance: total / counted,
      apart: gaps.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap)).slice(0, 6),
    });
  }

  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * How alike, in words.
 *
 * The distance is a mean gap in standard deviations across every measure, which
 * has no ceiling and no floor but zero. Printed bare beside a genre and a year
 * it reads as a score out of one — so a figure of 1.17 looks like a broken
 * scale rather than what it is, which is "about one standard deviation apart on
 * the average measure".
 *
 * Hence bands. A percentage would be worse than the raw number: it would imply
 * a precision that a sample of this size cannot support. The phrasing is
 * deliberately hedged, because what is being claimed is that some numbers sit
 * close together, not that two books read alike.
 */
export function howAlike(distance: number): string {
  if (distance < 0.45) return "measures very much like";
  if (distance < 0.7) return "measures like";
  if (distance < 1.0) return "has something in common with";
  if (distance < 1.4) return "measures some way from";
  return "measures nothing like";
}

/** The same bands, short enough to sit on a row. */
export function alikeBand(distance: number): { label: string; rank: number } {
  if (distance < 0.45) return { label: "very close", rank: 0 };
  if (distance < 0.7) return { label: "close", rank: 1 };
  if (distance < 1.0) return { label: "some in common", rank: 2 };
  if (distance < 1.4) return { label: "some way off", rank: 3 };
  return { label: "nothing alike", rank: 4 };
}

/**
 * What the number actually is, for anyone who wants to know.
 *
 * Kept out of the row and put on the hover, because it is the answer to a
 * question most people will not ask and a distraction from the band, which is
 * the answer to the one they will.
 */
export function distanceNote(distance: number): string {
  return `${distance.toFixed(2)} — the average gap across ${COMPARABLE.length} measures, in standard deviations. Zero is identical; there is no upper limit.`;
}
