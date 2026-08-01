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
const DASHES = new Set(["—", "–"]);

/** Letters or digits, so an apostrophe inside a word can be recognised. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

export function smartenText(input: string): string {
  if (!input) return input;

  // Dashes and the ellipsis first: they change what counts as the character
  // before a quote, which the quote pass then reads.
  // Triples first, so what is left of the pass is genuine pairs. Two hyphens
  // are an em dash and three an en, matching what typing them produces.
  let text = input
    .replace(/---/g, "–")
    .replace(/(?<!-)--(?!-)/g, "—")
    .replace(/\.\.\./g, "…");

  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = i > 0 ? out[out.length - 1] : undefined;
    const next = text[i + 1];

    if (ch === '"') {
      // A dash cuts both ways: «He turned—"Wait!"» opens, «"Wait—"» closes, and
      // the second is far the commoner in fiction. Unlike the editor, this pass
      // has the whole string, so it can look at what follows instead of
      // guessing — a letter after the quote means speech is starting.
      const opening =
        prev === undefined ||
        (DASHES.has(prev) ? next !== undefined && /[\p{L}\p{N}]/u.test(next) : OPENERS.has(prev));
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

const TYPED_OPENERS = new Set([" ", "\t", "\n", "(", "[", "{", "“", "‘", ""]);

/**
 * What a typed character should actually become, given what precedes it, or
 * null to let it through unchanged.
 *
 * Done a character at a time as it is typed rather than by sweeping the text
 * afterwards, so the caret never moves under the writer and an undo puts back
 * exactly what they typed. `replace` is how many characters before the caret
 * the substitution eats.
 */
export function autocorrectKeystroke(typed: string, before: string): { text: string; replace: number } | null {
  const prev = before.slice(-1);
  const prev2 = before.slice(-2);

  if (typed === '"') {
    return { text: TYPED_OPENERS.has(prev) ? "“" : "”", replace: 0 };
  }
  if (typed === "'") {
    // Inside a word it's an apostrophe: don't, o'clock, Maren's.
    if (/[\p{L}\p{N}]/u.test(prev)) return { text: "’", replace: 0 };
    return { text: TYPED_OPENERS.has(prev) ? "‘" : "’", replace: 0 };
  }
  // An elided decade — '90s, '73 — reads as an opening quote until the digit
  // arrives, which is only one keystroke later. Turning it round then is
  // invisible; guessing beforehand is impossible, since nothing follows it yet.
  if (/\p{N}/u.test(typed) && prev === "‘") {
    return { text: `’${typed}`, replace: 1 };
  }
  if (typed === "-") {
    // Two hyphens make an em dash, the way a word processor does it — it is by
    // far the commoner mark in prose, so it gets the shorter sequence. A third
    // hyphen steps back to the en dash, arriving after the em the second one
    // already produced, which keeps both reachable from the keyboard.
    if (prev === "—") return { text: "–", replace: 1 };
    if (prev === "-") return { text: "—", replace: 1 };
    return null;
  }
  if (typed === ".") {
    if (prev2 === "..") return { text: "…", replace: 2 };
    return null;
  }
  return null;
}
