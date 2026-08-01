import { countWords } from "./words.js";

/**
 * What the manuscript is made of.
 *
 * Counting, not judging. Nothing here says a sentence is too long or a word
 * used too often — it says how long and how often, and the writer decides.
 * Everything is derived from the prose as stored, so it is the same text the
 * word count and the search are working on.
 */

/** Words that hold sentences together rather than saying anything about them. */
const FUNCTION_WORDS = new Set(
  `a an the and or but nor for so yet of in on at to from by with without into onto
   over under above below between among through during before after since until
   is are was were be been being am do does did doing have has had having
   will would shall should can could may might must
   i me my mine myself you your yours yourself he him his himself she her hers herself
   it its itself we us our ours ourselves they them their theirs themselves
   this that these those there here what which who whom whose when where why how
   as if then than too very just not no nor only own same s t don now
   said says say`
    .split(/\s+/)
    .filter(Boolean),
);

export interface WordCount {
  word: string;
  count: number;
}

/**
 * Sentences, roughly.
 *
 * A full stop ends a sentence unless it is doing something else — an initial,
 * an abbreviation, a decimal. There is no perfect rule for this and none is
 * attempted: the aim is a mean length that moves the way the prose moves, not a
 * parser. Ellipses and dashes are left inside sentences, where they belong.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let current = "";

  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? "";
    current += ch;

    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // A run of stops is one ending: "!?" and "..." close once.
    let j = i + 1;
    while (j < chars.length && /[.!?…"'”’)\]]/u.test(chars[j] ?? "")) {
      current += chars[j];
      j += 1;
    }

    const next = chars[j];
    // Something has to follow the stop for it to have ended anything.
    if (next !== undefined && !/\s/u.test(next)) {
      i = j - 1;
      continue;
    }

    // A single capital before the stop is an initial, not an ending.
    const before = current.trim();
    if (/(^|\s)\p{Lu}\.$/u.test(before)) {
      i = j - 1;
      continue;
    }

    if (before) out.push(before);
    current = "";
    i = j - 1;
  }

  const rest = current.trim();
  if (rest) out.push(rest);
  return out;
}

export interface SentenceStats {
  count: number;
  /** Mean length in words. */
  mean: number;
  /** The middle length, which a few very long sentences cannot drag. */
  median: number;
  longest: { text: string; words: number } | null;
}

export function sentenceStats(text: string): SentenceStats {
  const found = sentences(text);
  const lengths = found.map((s) => countWords(s)).filter((n) => n > 0);
  if (lengths.length === 0) return { count: 0, mean: 0, median: 0, longest: null };

  const sorted = [...lengths].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const total = lengths.reduce((sum, n) => sum + n, 0);

  let longest = found[0] ?? "";
  let most = 0;
  for (const sentence of found) {
    const words = countWords(sentence);
    if (words > most) {
      most = words;
      longest = sentence;
    }
  }

  return {
    count: lengths.length,
    mean: Math.round((total / lengths.length) * 10) / 10,
    median:
      sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? 0),
    longest: { text: longest, words: most },
  };
}

/**
 * Every word, most used first.
 *
 * Apostrophes are kept — "don't" is a word — and case is folded, since a word
 * at the start of a sentence is the same word. Function words can be set aside:
 * left in, the first thirty entries are the same thirty in every book ever
 * written and say nothing about this one.
 */
export function wordFrequency(
  text: string,
  options: { withoutFunctionWords?: boolean; limit?: number } = {},
): WordCount[] {
  const counts = new Map<string, number>();

  for (const match of text.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
    const word = match[0].toLocaleLowerCase("en").replace(/[’]/g, "'").replace(/^-+|-+$/g, "");
    if (word.length < 2) continue;
    if (options.withoutFunctionWords && FUNCTION_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const out = [...counts].map(([word, count]) => ({ word, count }));
  // Ties broken alphabetically, so the list doesn't reshuffle between renders.
  out.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  return options.limit ? out.slice(0, options.limit) : out;
}

export interface LevelStats {
  depth: number;
  name: string;
  count: number;
  mean: number;
  median: number;
  longest: { label: string; words: number } | null;
  shortest: { label: string; words: number } | null;
}

/**
 * How the sections of each level compare.
 *
 * A section's length is its own words plus everything under it — a chapter is
 * as long as its scenes, and counting only the words typed directly into it
 * would say every chapter was empty.
 */
export function levelStats(
  sections: readonly { depth: number; label: string; words: number }[],
  levels: readonly { depth: number; name: string }[],
): LevelStats[] {
  const byDepth = new Map<number, { label: string; words: number }[]>();
  for (const section of sections) {
    const bucket = byDepth.get(section.depth) ?? [];
    bucket.push({ label: section.label, words: section.words });
    byDepth.set(section.depth, bucket);
  }

  const out: LevelStats[] = [];
  for (const [depth, bucket] of [...byDepth].sort((a, b) => a[0] - b[0])) {
    const lengths = bucket.map((s) => s.words).sort((a, b) => a - b);
    const middle = Math.floor(lengths.length / 2);
    const total = lengths.reduce((sum, n) => sum + n, 0);

    let longest = bucket[0] ?? null;
    let shortest = bucket[0] ?? null;
    for (const section of bucket) {
      if (longest && section.words > longest.words) longest = section;
      if (shortest && section.words < shortest.words) shortest = section;
    }

    out.push({
      depth,
      name: levels.find((l) => l.depth === depth)?.name ?? `Level ${depth + 1}`,
      count: bucket.length,
      mean: bucket.length ? Math.round(total / bucket.length) : 0,
      median:
        lengths.length === 0
          ? 0
          : lengths.length % 2 === 0
            ? Math.round(((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2)
            : (lengths[middle] ?? 0),
      longest,
      shortest,
    });
  }
  return out;
}
