/**
 * How a word is spelled for the purpose of looking it up.
 *
 * Shared by the browser, which runs the checker, and the server, which keeps
 * the writer's own words. The two have to agree on what counts as the same
 * word, or a word taught in one form goes on being flagged in another.
 */

/**
 * Straight apostrophes.
 *
 * The manuscript holds the typeset one — the punctuation pass puts it there,
 * and so does typing — while every Hunspell word list is written with the
 * typewriter one. Folding before lookup means "Brandan’s" and "Brandan's" are
 * one word rather than two, which is what a writer means by them.
 */
export function foldApostrophes(word: string): string {
  return word.replace(/[‘’ʼ]/g, "'");
}

/**
 * The word a possessive is made from: "Brandan's" → "Brandan", "dogs'" → "dogs".
 * Null when the word isn't one.
 *
 * A novel is full of names, and a name that has been taught to the checker
 * should not need teaching again the first time someone owns something. Used
 * both ways: teaching a possessive teaches the name under it, and a possessive
 * that isn't known is accepted if the name is.
 */
export function possessiveStem(word: string): string | null {
  const folded = foldApostrophes(word);
  const owned = /^(.+?)'s$/i.exec(folded);
  if (owned?.[1]) return owned[1];
  // A plural possessive takes the apostrophe alone: the Hallorans' house.
  const plural = /^(.+?s)'$/i.exec(folded);
  return plural?.[1] ?? null;
}

/**
 * The form a word is searched in.
 *
 * A manuscript is full of typeset punctuation — curled quotes, real dashes, a
 * single-character ellipsis — and a keyboard produces none of it. Someone
 * hunting for "Brandan's" types the straight apostrophe and someone hunting for
 * a trailing "..." types three dots; without this neither finds anything.
 *
 * Most substitutions are one character for one. The ellipsis is not: it is one
 * character standing for three, so folding it moves every offset after it. That
 * is what `foldForSearchMapped` is for — it keeps a note of where each folded
 * character came from, so a match found in the folded text can be pointed at
 * the right characters of the real one.
 */
const SEARCH_FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "ʼ": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
};

/** The folded text, for counting and comparing. */
export function foldForSearch(text: string): string {
  let out = "";
  for (const ch of text) out += (SEARCH_FOLD[ch] ?? ch).toLowerCase();
  return out;
}

export interface FoldedText {
  text: string;
  /**
   * Where each folded character came from, with one extra entry for the end —
   * so a folded range [a, b) is the real range [at[a], at[b]).
   */
  at: number[];
}

/** The same fold, with a note of where every character came from. */
export function foldForSearchMapped(text: string): FoldedText {
  let out = "";
  const at: number[] = [];
  let index = 0;

  for (const ch of text) {
    const folded = (SEARCH_FOLD[ch] ?? ch).toLowerCase();
    for (const _ of folded) at.push(index);
    out += folded;
    index += ch.length;
  }
  at.push(text.length);

  return { text: out, at };
}
