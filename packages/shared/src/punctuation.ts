/**
 * Typewriter marks to typeset ones.
 *
 * Straight quotes, double hyphens and three dots are what a keyboard produces;
 * a manuscript wants the real characters. The substitutions are textual rather
 * than presentational — they change what the prose *is*, not how it's drawn —
 * so they happen once at render and the stored text keeps whatever was typed.
 *
 * Deliberately conservative. Everything here is reversible by turning the
 * setting off, and nothing guesses at cases it can't get right: a quote whose
 * direction is genuinely ambiguous is left alone rather than turned the wrong
 * way, which is worse than leaving it straight.
 */

const OPENERS = new Set([" ", "\t", "\n", "(", "[", "{", "—", "–", "“", "‘"]);

/** Letters or digits, so an apostrophe inside a word can be recognised. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

export function smartenText(input: string): string {
  if (!input) return input;

  // Dashes and the ellipsis first: they change what counts as the character
  // before a quote, which the quote pass then reads.
  let text = input
    .replace(/---/g, "—")
    .replace(/(?<!-)--(?!-)/g, "–")
    .replace(/\.\.\./g, "…");

  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = i > 0 ? out[out.length - 1] : undefined;
    const next = text[i + 1];

    if (ch === '"') {
      const opening = prev === undefined || OPENERS.has(prev);
      out += opening ? "“" : "”";
      continue;
    }

    if (ch === "'") {
      // Inside a word it's an apostrophe: don't, o'clock, Maren's.
      if (isWordChar(prev) && isWordChar(next)) {
        out += "’";
        continue;
      }
      // Elided year or decade — '90s, '73 — is an apostrophe, not a quote.
      if (!isWordChar(prev) && next !== undefined && /\p{N}/u.test(next)) {
        out += "’";
        continue;
      }
      // Trailing on a word: plurals' possessive, or a closing single quote.
      if (isWordChar(prev)) {
        out += "’";
        continue;
      }
      const opening = prev === undefined || OPENERS.has(prev);
      out += opening ? "‘" : "’";
      continue;
    }

    out += ch;
  }

  return out;
}
