import type { StyleFeatures, StyleMeasurement } from "./style.js";

/**
 * What a writer's normal looks like, and how far a section sits from it.
 *
 * None of this is ever stored. A baseline is an average over whichever sections
 * the writer has chosen to include, and that choice changes with a click — so a
 * stored z-score would be a number about a corpus that no longer exists. Kept
 * raw and averaged on reading, excluding a chapter costs one pass over a few
 * hundred small rows and invalidates nothing, re-scans nothing, and asks no
 * model anything.
 *
 * The same reasoning `0017_digest.sql` gives for not storing an event's
 * position: it is a fraction of a whole that changes whenever any other part
 * does.
 */

/** A section's measurements, as the reading side receives them. */
export interface StyleSample {
  blockId: string;
  /** Which voice this section is written in — null for the book's own. */
  voice: string | null;
  /** Whether the writer counts this towards their normal. */
  included: boolean;
  measurement: StyleMeasurement;
}

/** Mean and spread of one feature over a corpus. */
export interface FeatureNorm {
  mean: number;
  sd: number;
}

/**
 * The running totals a mean and a spread are made of.
 *
 * Kept alongside the norms so a section can be taken back out of the average it
 * is about to be measured against, in three subtractions rather than by
 * averaging the whole corpus again for every section.
 */
export interface FeatureSums {
  w: number;
  wx: number;
  wxx: number;
}

export interface Baseline {
  /** Which voice this describes, and how much of it there was. */
  voice: string | null;
  sections: number;
  words: number;
  overall: Record<string, FeatureNorm>;
  narration: Record<string, FeatureNorm>;
  dialogue: Record<string, FeatureNorm>;
  /** The same, unaveraged, so one section can be left out of its own comparison. */
  sums: Record<Stream, Record<string, FeatureSums>>;
}

/** Which stream a comparison was made against. */
export type Stream = "overall" | "narration" | "dialogue";

/**
 * Below this a section's function-word rates are mostly noise.
 *
 * Not a hard cut — the numbers are still measured and still shown — but a
 * section under it is never *flagged*, because at three hundred words the
 * difference between a writer and themselves is larger than the difference
 * between two writers.
 */
export const RELIABLE_WORDS = 700;

/**
 * Below this a baseline is not worth trusting.
 *
 * Reported rather than enforced: a writer part-way through a first draft should
 * still see what has been measured, told plainly that it will move.
 */
export const THIN_CORPUS_WORDS = 25_000;

/**
 * Sections whose spread is worth averaging, weighted by length.
 *
 * Weighted, because a writer's normal is the normal of their prose, not of
 * their sections: twenty short scenes and one long chapter should not give the
 * scenes twenty times the say. A section's contribution is its word count.
 */
function totals(samples: StyleSample[], stream: Stream): Record<string, FeatureSums> {
  const out: Record<string, FeatureSums> = {};

  for (const s of samples) {
    const w = streamWords(s.measurement, stream);
    if (w <= 0) continue;
    for (const [key, value] of Object.entries(s.measurement[stream])) {
      // A section with no dialogue at all says nothing about dialogue, and
      // averaging its absent value in as zero would drag every rate down.
      if (value === undefined) continue;
      const acc = (out[key] ??= { w: 0, wx: 0, wxx: 0 });
      acc.w += w;
      acc.wx += w * value;
      acc.wxx += w * value * value;
    }
  }
  return out;
}

/** What one section contributed, for taking it back out again. */
function contributionOf(
  sample: StyleSample,
  stream: Stream,
  key: string,
): FeatureSums | null {
  const value = sample.measurement[stream][key];
  if (value === undefined) return null;
  const w = streamWords(sample.measurement, stream);
  if (w <= 0) return null;
  return { w, wx: w * value, wxx: w * value * value };
}

/** Mean and spread from running totals, optionally with one section removed. */
function normOf(sums: FeatureSums | undefined, without?: FeatureSums | null): FeatureNorm | null {
  if (!sums) return null;
  const w = sums.w - (without?.w ?? 0);
  // Nothing left to be normal about: one section cannot be its own baseline.
  if (w <= 0) return null;
  const wx = sums.wx - (without?.wx ?? 0);
  const wxx = sums.wxx - (without?.wxx ?? 0);
  const mean = wx / w;
  // Floating point can put this a hair below zero on a constant feature.
  const variance = Math.max(0, wxx / w - mean * mean);
  return { mean, sd: Math.sqrt(variance) };
}

function norms(samples: StyleSample[], stream: Stream): Record<string, FeatureNorm> {
  const out: Record<string, FeatureNorm> = {};
  for (const [key, sums] of Object.entries(totals(samples, stream))) {
    const norm = normOf(sums);
    if (norm) out[key] = norm;
  }
  return out;
}

/** How many words of this section belong to the stream being averaged. */
function streamWords(m: StyleMeasurement, stream: Stream): number {
  if (stream === "overall") return m.words;
  const spoken = m.words * m.dialogueShare;
  return stream === "dialogue" ? spoken : m.words - spoken;
}

/**
 * One baseline per voice.
 *
 * A letter, a dream, a second narrator: these differ from the book's ordinary
 * prose on purpose, and measured against one baseline they would fill the
 * report with a difference the writer already knows about. Each tagged voice
 * gets its own normal once there is enough of it to have one; below that it
 * falls back to the book's, which is the honest answer — with two letters in a
 * novel there is no such thing as the letters' style yet.
 */
export function baselines(samples: StyleSample[]): Map<string | null, Baseline> {
  const included = samples.filter((s) => s.included && s.measurement.words > 0);
  const out = new Map<string | null, Baseline>();

  const build = (voice: string | null, group: StyleSample[]): Baseline => ({
    voice,
    sections: group.length,
    words: group.reduce((sum, s) => sum + s.measurement.words, 0),
    overall: norms(group, "overall"),
    narration: norms(group, "narration"),
    dialogue: norms(group, "dialogue"),
    sums: {
      overall: totals(group, "overall"),
      narration: totals(group, "narration"),
      dialogue: totals(group, "dialogue"),
    },
  });

  out.set(null, build(null, included));

  const byVoice = new Map<string, StyleSample[]>();
  for (const s of included) {
    if (!s.voice) continue;
    byVoice.set(s.voice, [...(byVoice.get(s.voice) ?? []), s]);
  }
  for (const [voice, group] of byVoice) {
    const words = group.reduce((sum, s) => sum + s.measurement.words, 0);
    // Enough of it to be a voice rather than two examples of one.
    if (group.length >= 3 && words >= 3000) out.set(voice, build(voice, group));
  }

  return out;
}

/** One feature's distance from normal, in standard deviations. */
export interface Divergence {
  key: string;
  z: number;
  value: number;
  mean: number;
}

export interface SectionDeviation {
  blockId: string;
  words: number;
  voice: string | null;
  /** Which baseline it was measured against, once fallback is accounted for. */
  against: string | null;
  /** Mean absolute z across features — the distance from this writer's center. */
  delta: number;
  /** Whether the section is long enough for that number to mean anything. */
  reliable: boolean;
  /** The features that moved most, largest first. */
  moved: Divergence[];
  /** Per stream, so "your dialogue changed" is distinguishable from "your prose did". */
  byStream: Record<Stream, number>;
}

/** No single feature may count for more than this where they are averaged. */
const CLAMP = 8;

/** One feature's contribution to the distance, capped. */
const contribution = (z: number): number => Math.min(Math.abs(z), CLAMP);

/**
 * How far one feature sits from normal.
 *
 * Dividing by a spread of near zero is how stylometry produces its most
 * confident nonsense — every section uses one semicolon per thousand words,
 * this one uses two, therefore it is four hundred standard deviations from
 * normal. So the spread is floored at a twentieth of the mean: a feature that
 * varies less than that across a book is constant for practical purposes, and
 * differences in it are measured against that floor instead.
 *
 * Floored rather than dropped. Dropping was the first attempt and it was worse
 * in a way that took a test to see: on a short or consistent manuscript almost
 * every feature has a small spread, so almost everything was discarded, and
 * what survived to be reported was whatever happened to be noisiest. The
 * strongest signal in a book — a section whose sentences are a sixth the usual
 * length — was thrown away precisely because the writer was otherwise
 * consistent about sentence length.
 *
 * The distance itself is left as it falls. Clamping happens where the numbers
 * are averaged into one, so no single feature can swamp the rest — but not
 * here, because a clamped distance cannot be ranked: on a section that differs
 * in many ways at once, dozens of features hit the ceiling together and which
 * twelve get reported becomes an accident of iteration order.
 */
function diverge(
  value: number,
  norm: FeatureNorm | null | undefined,
  key: string,
): Divergence | null {
  if (!norm) return null;
  const floor = Math.max(Math.abs(norm.mean) * 0.05, 1e-9);
  const sd = Math.max(norm.sd, floor);
  return { key, z: (value - norm.mean) / sd, value, mean: norm.mean };
}

/**
 * Every included and excluded section, placed against the writer's normal.
 *
 * Excluded sections are measured too. A chapter kept out of the baseline
 * because it is a draft is exactly a chapter someone wants to ask "does this
 * sound like me yet?" about — leaving it unmeasured would answer the question
 * by refusing it.
 */
export function deviations(
  samples: StyleSample[],
  built: Map<string | null, Baseline>,
): SectionDeviation[] {
  const out: SectionDeviation[] = [];
  const book = built.get(null);
  if (!book) return out;

  for (const sample of samples) {
    const m = sample.measurement;
    if (m.words === 0) continue;

    const own = sample.voice ? built.get(sample.voice) : undefined;
    const against = own ?? book;

    /**
     * Measured against everything except itself.
     *
     * A section left in its own baseline drags the mean towards itself and
     * inflates the spread by exactly the amount it differs — so the more
     * unusual it is, the more it raises the bar it is being judged against, and
     * on a short manuscript every section comes out the same distance from
     * normal no matter how differently it is written. It defeats the whole
     * measurement, quietly, and looks like a working feature.
     *
     * Only if it was in there to begin with: an excluded section never
     * contributed and has nothing to take back out.
     */
    const normFor = (stream: Stream, key: string): FeatureNorm | null =>
      normOf(
        against.sums[stream][key],
        sample.included ? contributionOf(sample, stream, key) : null,
      );

    const perStream: Record<Stream, number> = { overall: 0, narration: 0, dialogue: 0 };
    const all: Divergence[] = [];

    for (const stream of ["overall", "narration", "dialogue"] as const) {
      // Too little of this stream here to say anything about it.
      if (streamWords(m, stream) < 120) continue;

      const found: Divergence[] = [];
      for (const [key, value] of Object.entries(m[stream])) {
        const d = diverge(value, normFor(stream, key), key);
        if (d) found.push(d);
      }
      if (found.length === 0) continue;

      perStream[stream] =
        found.reduce((sum, d) => sum + contribution(d.z), 0) / found.length;
      // Named by stream, so a report can say which half of the prose moved.
      if (stream !== "overall") {
        for (const d of found) all.push({ ...d, key: `${stream}:${d.key}` });
      }
    }

    // The headline distance is the overall stream: the two halves are for
    // saying *where* it moved, and adding them in would count the same prose
    // twice with the dialogue-heavy sections weighted oddly.
    const overallFound: Divergence[] = [];
    for (const [key, value] of Object.entries(m.overall)) {
      const d = diverge(value, normFor("overall", key), key);
      if (d) overallFound.push(d);
    }
    const delta =
      overallFound.length > 0
        ? overallFound.reduce((sum, d) => sum + contribution(d.z), 0) / overallFound.length
        : 0;

    const moved = [...overallFound, ...all]
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 12);

    out.push({
      blockId: sample.blockId,
      words: m.words,
      voice: sample.voice,
      against: own ? sample.voice : null,
      delta,
      reliable: m.words >= RELIABLE_WORDS,
      moved,
      byStream: perStream,
    });
  }

  return out;
}

/**
 * The sections that sound most like the writer.
 *
 * Most characteristic, which is not the same as best — and the difference
 * matters enough to keep out of the name. A writer's finest page may well be
 * the one where they departed from themselves. What this finds is the prose
 * closest to the middle of everything they have written, which is what a model
 * should be shown when it is asked to sound like them, and what a reader should
 * be shown when they ask what their normal actually is.
 */
export function mostCharacteristic(
  deviation: SectionDeviation[],
  samples: StyleSample[],
  limit = 8,
): string[] {
  const included = new Set(samples.filter((s) => s.included).map((s) => s.blockId));
  return deviation
    .filter((d) => included.has(d.blockId) && d.reliable)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, limit)
    .map((d) => d.blockId);
}

/** The included sections that least resemble the rest, longest first among ties. */
export function leastCharacteristic(
  deviation: SectionDeviation[],
  samples: StyleSample[],
  limit = 8,
): SectionDeviation[] {
  const included = new Set(samples.filter((s) => s.included).map((s) => s.blockId));
  return deviation
    .filter((d) => included.has(d.blockId) && d.reliable)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit);
}
