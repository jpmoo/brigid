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
 * A manuscript is full of typeset punctuation — curled quotes, real dashes —
 * and a keyboard produces none of it. Someone hunting for "Brandan's" types the
 * straight apostrophe, and without this it matches nothing, which is the same
 * mismatch that stopped the checker recognising words it had been taught.
 *
 * Every substitution is one character for one, deliberately. Matching reports
 * offsets into the text, and the highlight slices the original at them, so a
 * fold that changed any length would move every match after it. That rules out
 * the ellipsis — "..." is three characters and "…" is one — which is left
 * alone rather than quietly shifting the results.
 */
const SEARCH_FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "ʼ": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
};

export function foldForSearch(text: string): string {
  return text.replace(/[‘’ʼ“”–—]/g, (c) => SEARCH_FOLD[c] ?? c).toLowerCase();
}
