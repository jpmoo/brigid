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
