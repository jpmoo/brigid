/**
 * A writer's fingerprint, measured rather than judged.
 *
 * Everything here is arithmetic over the prose — no model is involved, and none
 * can be. That is the point. A model can say a passage feels unlike the rest of
 * a book; it cannot say so twice the same way, and two of its opinions cannot
 * be subtracted from each other. Numbers can, which is the only way to answer
 * "does this match?" at all.
 *
 * So the model's job is to read these, not to produce them. It gets the numbers
 * and writes prose about them; it gets exemplar passages and imitates them. The
 * measuring is done here, once, cheaply, and identically every time.
 *
 * Nothing in this file knows what a baseline is. A feature is measured against
 * the section it came from and nothing else, because the corpus a section is
 * compared to changes whenever the writer excludes a chapter — so the
 * comparison is worked out on reading, and only the raw measurements are kept.
 * The same reasoning the digest gives for not storing an event's position.
 */

/**
 * Sentence splitting is the manuscript's own — the same one the statistics pane
 * counts with. A second rule would drift from the first, and a fingerprint that
 * disagreed with the word count about what a sentence is would be measuring a
 * different book from the one on screen.
 */
import { sentences } from "./stats.js";

export { sentences };

/** One measured value per named feature, all of them per-something rates. */
export type StyleFeatures = Record<string, number>;

/**
 * A section measured three ways.
 *
 * Once over everything, and then separately over what is spoken and what is
 * not — because a scene that is mostly dialogue differs from a scene that is
 * mostly narration in every feature at once, and comparing the two would
 * report that difference as a change of voice. It isn't one. Held apart, a
 * writer's dialogue is compared with their dialogue and their narration with
 * their narration, and what is left over is style.
 */
export interface StyleMeasurement {
  words: number;
  sentences: number;
  paragraphs: number;
  /** Share of words inside quotation marks. */
  dialogueShare: number;
  overall: StyleFeatures;
  narration: StyleFeatures;
  dialogue: StyleFeatures;
}

/**
 * The commonest function words in English.
 *
 * The oldest and strongest signal in stylometry, and most of the count here.
 * They carry no subject matter — a chapter about a battle and a chapter about a
 * funeral use "of" at whatever rate the writer uses "of" — so they measure the
 * hand rather than the topic, which is exactly the separation wanted. A
 * feature that moved because the scene changed is a feature that tells us
 * nothing about style.
 */
const FUNCTION_WORDS = [
  "the", "of", "and", "a", "to", "in", "is", "was", "it", "that", "he", "she",
  "for", "as", "with", "his", "her", "on", "be", "at", "by", "i", "this", "had",
  "not", "are", "but", "from", "or", "have", "an", "they", "which", "one", "you",
  "were", "all", "we", "when", "your", "can", "said", "there", "use", "each",
  "would", "how", "their", "if", "will", "up", "other", "about", "out", "many",
  "then", "them", "these", "so", "some", "into", "has", "more", "two", "like",
  "him", "see", "no", "could", "than", "been", "now", "did", "down", "way",
  "who", "its", "made", "may", "over", "such", "our", "me", "any", "after",
  "back", "little", "only", "round", "man", "year", "came", "show", "every",
  "good", "under", "just", "through", "much", "before", "must", "well", "should",
  "because", "does", "part", "even", "place", "here", "off", "went", "old",
  "same", "tell", "why", "ask", "again", "still", "between", "own", "while",
  "might", "against", "never", "another", "us", "away", "without", "upon",
  "though", "always", "both", "where", "those", "being", "am", "shall", "yet",
  "once", "until", "toward", "among", "along", "behind", "beside", "beneath",
  "across", "around", "within", "during", "since", "unless", "whether", "nor",
  "either", "neither", "perhaps", "almost", "already", "enough", "rather",
  "quite", "least", "most", "less", "few", "several", "whose", "whom",
] as const;

/**
 * Verbs that put a narrator between the reader and the scene.
 *
 * "She saw the door open" rather than "the door opened". A real craft signal
 * and one writers argue about, so it is worth measuring rather than guessing
 * at: a writer who filters heavily and stops has changed something a reader
 * will feel.
 */
const FILTERING_VERBS = [
  "saw", "see", "sees", "seeing", "watched", "watches", "noticed", "notices",
  "heard", "hears", "hearing", "listened", "felt", "feels", "feeling",
  "smelled", "smelt", "tasted", "touched", "sensed", "senses",
  "realised", "realized", "realises", "realizes", "knew", "knows", "thought",
  "thinks", "wondered", "wonders", "decided", "decides", "remembered",
  "remembers", "seemed", "seems", "appeared", "appears", "looked",
];

/** Words that lean on a verb rather than choosing a stronger one. */
const INTENSIFIERS = [
  "very", "really", "quite", "rather", "extremely", "incredibly", "totally",
  "absolutely", "completely", "utterly", "terribly", "awfully", "pretty",
  "fairly", "somewhat", "slightly", "highly", "deeply", "truly", "so",
];

/** Words that soften a claim. */
const HEDGES = [
  "perhaps", "maybe", "possibly", "probably", "seemingly", "apparently",
  "presumably", "arguably", "somehow", "sort", "kind", "almost", "nearly",
  "about", "roughly", "supposedly", "allegedly",
];

const MODALS = [
  "can", "could", "may", "might", "must", "shall", "should", "will", "would",
  "ought",
];

/** The verbs a line of speech is hung on. */
const SPEECH_TAGS = [
  "said", "asked", "replied", "answered", "shouted", "whispered", "murmured",
  "muttered", "cried", "called", "added", "began", "continued", "told",
  "explained", "admitted", "agreed", "offered", "demanded", "insisted",
  "repeated", "returned", "observed", "remarked", "protested", "snapped",
  "growled", "hissed", "breathed", "sighed", "laughed", "yelled",
];

/** Endings that mark a word as borrowed rather than native. */
const LATINATE_ENDINGS = [
  "tion", "sion", "ment", "ity", "ous", "ive", "ate", "ance", "ence", "ical",
  "ise", "ize", "ify", "able", "ible", "ary", "ory",
];

const FIRST_PERSON = ["i", "me", "my", "mine", "myself", "we", "us", "our", "ours"];
const SECOND_PERSON = ["you", "your", "yours", "yourself", "yourselves"];
const THIRD_PERSON = [
  "he", "him", "his", "she", "her", "hers", "it", "its", "they", "them",
  "their", "theirs",
];

/** Sentence openers worth counting on their own, because writers notice them. */
const CONJUNCTION_OPENERS = ["and", "but", "or", "so", "yet", "for", "nor"];

const set = (words: readonly string[]): Set<string> => new Set(words);

const FILTER_SET = set(FILTERING_VERBS);
const INTENSIFIER_SET = set(INTENSIFIERS);
const HEDGE_SET = set(HEDGES);
const MODAL_SET = set(MODALS);
const TAG_SET = set(SPEECH_TAGS);
const FIRST_SET = set(FIRST_PERSON);
const SECOND_SET = set(SECOND_PERSON);
const THIRD_SET = set(THIRD_PERSON);
const OPENER_SET = set(CONJUNCTION_OPENERS);

/** Lowercased words, apostrophes kept because "don't" is one word. */
export function tokens(text: string): string[] {
  const found = text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu);
  return found ? found.map((w) => w.replace(/[’]/g, "'")) : [];
}

/**
 * Paragraphs, as the manuscript stores them.
 *
 * Line endings are normalized first. A blank line between paragraphs is two
 * newlines when the text was written here and `\r\n\r\n` when it came from
 * anywhere Windows has been — and a rule looking for two consecutive newlines
 * finds none of the second kind. Every book in the reference set measured as a
 * single paragraph the length of the whole novel before this, which is the
 * loudest a bug of this shape ever gets: had it been subtler it would simply
 * have been wrong.
 */
export function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * The spoken and the unspoken, separated.
 *
 * Straight and typeset double quotes both, since a manuscript may hold either
 * depending on whether its format typesets them. Single quotes are deliberately
 * not treated as speech: an apostrophe is the same character, and "don't" would
 * open a quotation that never closes and swallow the rest of the section.
 */
export function splitSpeech(text: string): { spoken: string; narrated: string } {
  let spoken = "";
  let narrated = "";
  let open: string | null = null;
  let buffer = "";

  const closerFor = (ch: string) => (ch === "“" ? "”" : '"');

  for (const ch of text) {
    if (open === null) {
      if (ch === '"' || ch === "“") {
        narrated += buffer;
        buffer = "";
        open = closerFor(ch);
        continue;
      }
      buffer += ch;
      continue;
    }

    if (ch === open) {
      spoken += `${buffer} `;
      buffer = "";
      open = null;
      continue;
    }
    buffer += ch;
  }

  // An unclosed quotation is a typo, not a license to call the rest of the
  // section dialogue. What is left goes back to narration.
  narrated += buffer;
  return { spoken: spoken.trim(), narrated: narrated.trim() };
}

/** Vowel groups, which is as close to syllables as is worth getting. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Mean, and standard deviation about it. */
function spread(values: number[]): { mean: number; sd: number; skew: number } {
  if (values.length === 0) return { mean: 0, sd: 0, skew: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  const skew =
    sd > 0
      ? values.reduce((sum, v) => sum + ((v - mean) / sd) ** 3, 0) / values.length
      : 0;
  return { mean, sd, skew };
}

const rate = (count: number, per: number): number => (per > 0 ? count / per : 0);

/**
 * Every measurable habit of one stretch of prose.
 *
 * Rates rather than counts throughout, so a long section and a short one are
 * directly comparable. Where a count would be meaningless below some length —
 * a type-token ratio over forty words says nothing — the feature is still
 * emitted, and it is the reading side's job to widen its bands for short
 * sections rather than this one's to guess.
 */
export function features(text: string): StyleFeatures {
  const words = tokens(text);
  const sents = sentences(text);
  const paras = paragraphs(text);
  const n = words.length;

  const f: StyleFeatures = {};
  if (n === 0) return f;

  // --- Sentence architecture -------------------------------------------
  const lengths = sents.map((s) => tokens(s).length).filter((l) => l > 0);
  const len = spread(lengths);
  f["sent.mean"] = len.mean;
  f["sent.sd"] = len.sd;
  f["sent.skew"] = len.skew;
  f["sent.short"] = rate(lengths.filter((l) => l <= 5).length, lengths.length);
  f["sent.long"] = rate(lengths.filter((l) => l >= 30).length, lengths.length);
  f["sent.per1k"] = rate(sents.length * 1000, n);

  // A fragment: no finite verb to speak of. Proxied by having no word from the
  // small set of things a clause is usually built around.
  const finite = /\b(is|are|was|were|be|been|am|has|have|had|do|does|did|will|would|can|could|may|might|must|shall|should)\b/;
  f["sent.fragment"] = rate(
    sents.filter((s) => tokens(s).length <= 6 && !finite.test(s.toLowerCase())).length,
    Math.max(1, sents.length),
  );

  // --- Punctuation ------------------------------------------------------
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const perSentence = Math.max(1, sents.length);
  f["punct.comma"] = rate(count(/,/g), perSentence);
  f["punct.semicolon"] = rate(count(/;/g) * 1000, n);
  f["punct.colon"] = rate(count(/:/g) * 1000, n);
  f["punct.dash"] = rate(count(/—|--/g) * 1000, n);
  f["punct.paren"] = rate(count(/\(/g) * 1000, n);
  f["punct.ellipsis"] = rate(count(/…|\.\.\./g) * 1000, n);
  f["punct.question"] = rate(sents.filter((s) => /\?["'”’)\]]*$/.test(s)).length, perSentence);
  f["punct.exclaim"] = rate(sents.filter((s) => /!["'”’)\]]*$/.test(s)).length, perSentence);

  // --- Paragraphs -------------------------------------------------------
  const paraWords = paras.map((p) => tokens(p).length);
  const paraSents = paras.map((p) => sentences(p).length);
  f["para.words"] = spread(paraWords).mean;
  f["para.sentences"] = spread(paraSents).mean;
  f["para.single"] = rate(paraSents.filter((c) => c === 1).length, Math.max(1, paras.length));

  // --- Lexis ------------------------------------------------------------
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  // Standardised over a fixed window: a type-token ratio falls as text grows,
  // so an unstandardised one would measure length rather than vocabulary.
  const window = Math.min(n, 400);
  const sample = new Set(words.slice(0, window));
  f["lex.ttr"] = rate(sample.size, window);
  f["lex.hapax"] = rate([...counts.values()].filter((c) => c === 1).length, counts.size);
  f["lex.wordlen"] = spread(words.map((w) => w.length)).mean;
  f["lex.syllables"] = spread(words.map(syllables)).mean;
  f["lex.polysyll"] = rate(words.filter((w) => syllables(w) >= 3).length, n);
  f["lex.monosyll"] = rate(words.filter((w) => syllables(w) === 1).length, n);
  f["lex.latinate"] = rate(
    words.filter((w) => LATINATE_ENDINGS.some((e) => w.endsWith(e))).length,
    n,
  );

  // --- Function words ---------------------------------------------------
  // The bulk of the fingerprint, and the part that measures the hand rather
  // than the subject.
  for (const word of FUNCTION_WORDS) {
    f[`fw.${word}`] = rate((counts.get(word) ?? 0) * 1000, n);
  }

  // --- Openers ----------------------------------------------------------
  const openers = sents.map((s) => tokens(s)[0]).filter(Boolean) as string[];
  f["open.conjunction"] = rate(
    openers.filter((w) => OPENER_SET.has(w)).length,
    Math.max(1, openers.length),
  );
  f["open.participle"] = rate(
    openers.filter((w) => w.endsWith("ing")).length,
    Math.max(1, openers.length),
  );
  f["open.pronoun"] = rate(
    openers.filter((w) => FIRST_SET.has(w) || THIRD_SET.has(w) || SECOND_SET.has(w)).length,
    Math.max(1, openers.length),
  );
  f["open.the"] = rate(openers.filter((w) => w === "the").length, Math.max(1, openers.length));
  // How often two sentences in a row start the same way.
  let repeats = 0;
  for (let i = 1; i < openers.length; i += 1) if (openers[i] === openers[i - 1]) repeats += 1;
  f["open.repeat"] = rate(repeats, Math.max(1, openers.length - 1));

  // --- Distance and person ----------------------------------------------
  f["pov.first"] = rate(words.filter((w) => FIRST_SET.has(w)).length * 1000, n);
  f["pov.second"] = rate(words.filter((w) => SECOND_SET.has(w)).length * 1000, n);
  f["pov.third"] = rate(words.filter((w) => THIRD_SET.has(w)).length * 1000, n);
  f["pov.filtering"] = rate(words.filter((w) => FILTER_SET.has(w)).length * 1000, n);
  // Past against present, proxied on regular endings and the commonest verbs.
  const past = words.filter((w) => w.endsWith("ed") || ["was", "were", "had", "did"].includes(w)).length;
  const present = words.filter((w) => ["is", "are", "has", "does", "am"].includes(w)).length;
  f["pov.past"] = rate(past, Math.max(1, past + present));

  // --- Modifiers and stance ---------------------------------------------
  f["mod.adverb"] = rate(words.filter((w) => w.endsWith("ly") && w.length > 4).length * 1000, n);
  f["mod.intensifier"] = rate(words.filter((w) => INTENSIFIER_SET.has(w)).length * 1000, n);
  f["mod.hedge"] = rate(words.filter((w) => HEDGE_SET.has(w)).length * 1000, n);
  f["mod.modal"] = rate(words.filter((w) => MODAL_SET.has(w)).length * 1000, n);
  f["mod.negation"] = rate(
    words.filter((w) => w === "not" || w.endsWith("n't") || w === "no" || w === "never").length * 1000,
    n,
  );

  // --- Rhythm -----------------------------------------------------------
  f["rhythm.syllPerSent"] = rate(words.reduce((s, w) => s + syllables(w), 0), perSentence);
  // Consecutive words sharing an initial letter, which is as much of an
  // alliteration measure as can be had without pronunciation.
  let alliterative = 0;
  for (let i = 1; i < words.length; i += 1) {
    if (words[i]![0] === words[i - 1]![0]) alliterative += 1;
  }
  f["rhythm.alliteration"] = rate(alliterative * 1000, n);

  return f;
}

/**
 * A section measured, dialogue and narration held apart.
 *
 * The speech tag features are computed on the whole text rather than on either
 * stream, because a tag lives in the narration and describes the dialogue: it
 * belongs to neither and is a fact about how the two are joined.
 */
export function measure(text: string): StyleMeasurement {
  const clean = text.trim();
  const { spoken, narrated } = splitSpeech(clean);
  const allWords = tokens(clean).length;
  const spokenWords = tokens(spoken).length;

  const overall = features(clean);

  // How speech is attributed: the writer's habit, and a strong one.
  const tagWords = tokens(narrated);
  overall["tag.said"] = rate(tagWords.filter((w) => w === "said").length, Math.max(1, tagWords.filter((w) => TAG_SET.has(w)).length));
  overall["tag.rate"] = rate(tagWords.filter((w) => TAG_SET.has(w)).length * 1000, Math.max(1, allWords));
  overall["tag.adverb"] = rate(
    (narrated.match(/\b(said|asked|replied|answered|added|muttered|murmured)\s+\w+ly\b/gi) ?? []).length * 1000,
    Math.max(1, allWords),
  );

  return {
    words: allWords,
    sentences: sentences(clean).length,
    paragraphs: paragraphs(clean).length,
    dialogueShare: rate(spokenWords, Math.max(1, allWords)),
    overall,
    narration: features(narrated),
    dialogue: features(spoken),
  };
}

/**
 * A short, readable name for a feature, for anything a person will see.
 *
 * The keys are terse because they are stored on every section; these are what
 * a report says instead. Function words are given as themselves — "how often
 * you write 'the'" needs no gloss and inventing one would only obscure it.
 */
export function featureLabel(key: string): string {
  if (key.startsWith("fw.")) return `“${key.slice(3)}”`;
  return FEATURE_LABELS[key] ?? key;
}

/**
 * What a feature is counted in.
 *
 * Not decoration. These share a column and do not share a denominator: commas
 * are per sentence, dashes are per thousand words, and a vocabulary range is a
 * proportion. Shown side by side with no units, "commas 2.01" above "dashes
 * 1.57" reads as though a writer used a dash one and a half times a sentence,
 * which is not a small misreading — it is off by the length of a sentence.
 *
 * A percentage where the number is a share, because 0.03 of the words being
 * Latinate is a fact most people would rather read as 3%.
 */
export function featureUnit(key: string): { unit: string; percent: boolean } {
  if (key.startsWith("fw.")) return { unit: "per 1,000 words", percent: false };
  return FEATURE_UNITS[key] ?? { unit: "", percent: false };
}

const PER_THOUSAND = { unit: "per 1,000 words", percent: false };
const SHARE_OF_SENTENCES = { unit: "of sentences", percent: true };

const FEATURE_UNITS: Record<string, { unit: string; percent: boolean }> = {
  "sent.mean": { unit: "words", percent: false },
  "sent.sd": { unit: "words either way", percent: false },
  "sent.skew": { unit: "", percent: false },
  "sent.short": SHARE_OF_SENTENCES,
  "sent.long": SHARE_OF_SENTENCES,
  "sent.fragment": SHARE_OF_SENTENCES,
  "sent.per1k": PER_THOUSAND,
  "punct.comma": { unit: "per sentence", percent: false },
  "punct.semicolon": PER_THOUSAND,
  "punct.colon": PER_THOUSAND,
  "punct.dash": PER_THOUSAND,
  "punct.paren": PER_THOUSAND,
  "punct.ellipsis": PER_THOUSAND,
  "punct.question": SHARE_OF_SENTENCES,
  "punct.exclaim": SHARE_OF_SENTENCES,
  "para.words": { unit: "words", percent: false },
  "para.sentences": { unit: "sentences", percent: false },
  "para.single": { unit: "of paragraphs", percent: true },
  "lex.ttr": { unit: "distinct, in any 400 words", percent: true },
  "lex.hapax": { unit: "of the vocabulary", percent: true },
  "lex.wordlen": { unit: "letters", percent: false },
  "lex.syllables": { unit: "syllables", percent: false },
  "lex.polysyll": { unit: "of words", percent: true },
  "lex.monosyll": { unit: "of words", percent: true },
  "lex.latinate": { unit: "of words", percent: true },
  "open.conjunction": SHARE_OF_SENTENCES,
  "open.participle": SHARE_OF_SENTENCES,
  "open.pronoun": SHARE_OF_SENTENCES,
  "open.the": SHARE_OF_SENTENCES,
  "open.repeat": { unit: "of consecutive pairs", percent: true },
  "pov.first": PER_THOUSAND,
  "pov.second": PER_THOUSAND,
  "pov.third": PER_THOUSAND,
  "pov.filtering": PER_THOUSAND,
  "pov.past": { unit: "of tensed verbs", percent: true },
  "mod.adverb": PER_THOUSAND,
  "mod.intensifier": PER_THOUSAND,
  "mod.hedge": PER_THOUSAND,
  "mod.modal": PER_THOUSAND,
  "mod.negation": PER_THOUSAND,
  "rhythm.syllPerSent": { unit: "syllables per sentence", percent: false },
  "rhythm.alliteration": PER_THOUSAND,
  "tag.said": { unit: "of speech tags", percent: true },
  "tag.rate": PER_THOUSAND,
  "tag.adverb": PER_THOUSAND,
};

const FEATURE_LABELS: Record<string, string> = {
  "sent.mean": "sentence length",
  "sent.sd": "variety in sentence length",
  "sent.skew": "lean towards long or short sentences",
  "sent.short": "very short sentences",
  "sent.long": "very long sentences",
  "sent.per1k": "sentences per thousand words",
  "sent.fragment": "fragments",
  "punct.comma": "commas per sentence",
  "punct.semicolon": "semicolons",
  "punct.colon": "colons",
  "punct.dash": "dashes",
  "punct.paren": "parentheses",
  "punct.ellipsis": "ellipses",
  "punct.question": "questions",
  "punct.exclaim": "exclamations",
  "para.words": "paragraph length",
  "para.sentences": "sentences per paragraph",
  "para.single": "one-sentence paragraphs",
  "lex.ttr": "vocabulary range",
  "lex.hapax": "words used only once",
  "lex.wordlen": "word length",
  "lex.syllables": "syllables per word",
  "lex.polysyll": "long words",
  "lex.monosyll": "one-syllable words",
  "lex.latinate": "Latinate words",
  "open.conjunction": "sentences opening on “and” or “but”",
  "open.participle": "sentences opening on an -ing word",
  "open.pronoun": "sentences opening on a pronoun",
  "open.the": "sentences opening on “the”",
  "open.repeat": "consecutive sentences opening alike",
  "pov.first": "first person",
  "pov.second": "second person",
  "pov.third": "third person",
  "pov.filtering": "filtering (“she saw”, “he felt”)",
  "pov.past": "past tense",
  "mod.adverb": "-ly adverbs",
  "mod.intensifier": "intensifiers (“very”, “quite”)",
  "mod.hedge": "hedging (“perhaps”, “almost”)",
  "mod.modal": "modals (“could”, “would”)",
  "mod.negation": "negation",
  "rhythm.syllPerSent": "syllables per sentence",
  "rhythm.alliteration": "alliteration",
  "tag.said": "“said” among speech tags",
  "tag.rate": "speech tags",
  "tag.adverb": "adverbs on speech tags",
};
