import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nspell from "nspell";
import { foldApostrophes, possessiveStem } from "@brigid/shared";
import { api } from "./api.js";
import type { DictionaryWord } from "./api.js";

/**
 * Spelling, checked in the browser.
 *
 * The dictionary is half a megabyte and the check has to answer between one
 * keystroke and the next, so it lives here rather than behind a request. The
 * server's only part is handing over the Hunspell files once and keeping the
 * writer's own words, which are the half that matters: a novel is full of names
 * no dictionary has, and a checker that keeps underlining them is one that gets
 * switched off within the hour.
 */

export interface Speller {
  /** False when the word is not known and should be marked. */
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
  /** Teach it a word for the rest of this session, before the save returns. */
  learn: (word: string) => void;
}

/**
 * What counts as a word to check.
 *
 * Letters and the apostrophes inside them — "don't" and "o'clock" are single
 * words, and the typeset apostrophe is the same character the renderer puts
 * there, so both forms have to be recognised. Anything with a digit in it is
 * left alone: "1990s" and "3pm" are not spelling mistakes, and a dictionary has
 * no opinion about them.
 */
const WORD = /[\p{L}][\p{L}'’]*/gu;

export function isCheckable(word: string): boolean {
  if (word.length < 2) return false;
  return !/\d/.test(word);
}

/** Every word in a string, with where it starts. */
export function words(text: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = [];
  WORD.lastIndex = 0;
  for (;;) {
    const match = WORD.exec(text);
    if (!match) break;
    if (isCheckable(match[0])) out.push({ word: match[0], at: match.index });
  }
  return out;
}

/**
 * Teaches the checker a word, and the name under it when it is a possessive.
 *
 * Both directions matter. Teaching "Brandan's" has to settle "Brandan", or the
 * next sentence flags it; and the stored form is folded to a straight
 * apostrophe first, because that is the form every lookup asks about. Adding
 * the typeset form was the whole bug: the word taught and the word looked up
 * were never the same string.
 */
function teach(checker: ReturnType<typeof nspell>, word: string): void {
  const base = foldApostrophes(word);
  checker.add(base);
  const stem = possessiveStem(base);
  if (stem) checker.add(stem);
}

export interface SpellingState {
  /** Undefined until settings have loaded; then whether checking is wanted. */
  enabled: boolean;
  /** Null until the dictionary has arrived — nothing is marked before then. */
  speller: Speller | null;
  customWords: DictionaryWord[];
  /** Adds to the writer's dictionary, and stops marking it at once. */
  addWord: (word: string) => Promise<void>;
  /** Silences a word for this session only, without saving it. */
  ignoreWord: (word: string) => void;
  removeWord: (id: string) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  reload: () => Promise<void>;
}

export function useSpelling(): SpellingState {
  const [enabled, setEnabledState] = useState(false);
  const [customWords, setCustomWords] = useState<DictionaryWord[]>([]);
  const [checker, setChecker] = useState<ReturnType<typeof nspell> | null>(null);
  // Bumped whenever the checker learns something, since nspell mutates in place
  // and React has no way to see that on its own.
  const [generation, setGeneration] = useState(0);
  const ignored = useRef(new Set<string>());
  const loading = useRef(false);

  const reload = useCallback(async () => {
    const { enabled: on, words: rows } = await api.getSpelling();
    setEnabledState(on);
    setCustomWords(rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The dictionary is fetched only once checking is actually switched on, so
  // turning it off costs nothing on load.
  useEffect(() => {
    if (!enabled || checker || loading.current) return;
    loading.current = true;
    void (async () => {
      try {
        const { aff, dic } = await api.getDictionary();
        setChecker(nspell(aff, dic));
      } finally {
        loading.current = false;
      }
    })();
  }, [enabled, checker]);

  // The writer's words are added to the checker itself rather than consulted
  // beside it, so suggestions can offer them too.
  useEffect(() => {
    if (!checker) return;
    for (const row of customWords) teach(checker, row.word);
    setGeneration((n) => n + 1);
  }, [checker, customWords]);

  const speller = useMemo<Speller | null>(() => {
    if (!enabled || !checker) return null;
    void generation;
    return {
      correct: (word) => {
        const base = foldApostrophes(word);
        if (ignored.current.has(base.toLocaleLowerCase("en"))) return true;
        // A word at the start of a sentence is capitalised, and Hunspell is
        // right to accept that; one in small caps or shouted is not a mistake
        // either. Falling back to the lowercase form covers both.
        if (checker.correct(base) || checker.correct(base.toLocaleLowerCase("en"))) return true;
        // A known name owning something is not a misspelling.
        const stem = possessiveStem(base);
        return (
          stem !== null &&
          (checker.correct(stem) || checker.correct(stem.toLocaleLowerCase("en")))
        );
      },
      suggest: (word) => checker.suggest(foldApostrophes(word)).slice(0, 6),
      learn: (word) => {
        teach(checker, word);
        setGeneration((n) => n + 1);
      },
    };
  }, [enabled, checker, generation]);

  const addWord = useCallback(
    async (word: string) => {
      // Learned locally first: the underline should go the moment it's chosen,
      // not a round trip later.
      if (checker) teach(checker, word);
      setGeneration((n) => n + 1);
      const { word: row } = await api.addDictionaryWord(word);
      setCustomWords((current) =>
        current.some((w) => w.id === row.id) ? current : [...current, row],
      );
    },
    [checker],
  );

  const ignoreWord = useCallback((word: string) => {
    ignored.current.add(foldApostrophes(word).toLocaleLowerCase("en"));
    setGeneration((n) => n + 1);
  }, []);

  const removeWord = useCallback(async (id: string) => {
    await api.deleteDictionaryWord(id);
    setCustomWords((current) => current.filter((w) => w.id !== id));
    // nspell has no remove, so the word stays known until the page is next
    // loaded. Saying so in the list would be noise; it corrects itself.
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    const { enabled: saved } = await api.setSpellcheckEnabled(next);
    setEnabledState(saved);
  }, []);

  return {
    enabled,
    speller,
    customWords,
    addWord,
    ignoreWord,
    removeWord,
    setEnabled,
    reload,
  };
}
