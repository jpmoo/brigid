/**
 * What one reading of a section yields.
 *
 * A novel does not fit in a model's context, but both reference documents ask
 * for whole-story judgments: the structure models want proportions ("if the
 * midpoint must be located at the 80% mark, the story does not fit"), and the
 * character axes want whole-story presence and one character weighed against
 * another. So the book is read once, a section at a time, into this — and the
 * frameworks are judged against the digest, which does fit.
 *
 * The rule these shapes are built around: **observations, not verdicts**. A
 * section digest records what happened and what someone did. It does not score
 * an axis or name a beat, because a reader who has seen one chapter cannot
 * know whether a departure is the Crossing of the First Threshold or an
 * errand. Judgment happens once, at the end, with the whole digest in view.
 */

/** A person as one section shows them. */
export interface DigestCharacter {
  /** As the prose names them here. Reconciled into one identity later. */
  name: string;
  /** Other names this section uses for them — title, nickname, epithet. */
  aliases?: string[];
  /**
   * What they did, said, wanted, refused, and had done to them, as plain
   * statements. These become the citable events the axes rubric demands for
   * every score of 2 or higher, so each should name an act, not a quality:
   * "gives Ines the key to the observatory", not "is generous".
   */
  actions: string[];
  /** What they are shown to want here, if the section shows it. */
  wants?: string[];
  /** How they are described, and by whom — for the shape, not the score. */
  traits?: string[];
  /** Named others they act on or with, for the relational axes. */
  relations?: { who: string; what: string }[];
}

/** Something that happens, in the order the section tells it. */
export interface DigestEvent {
  /** One sentence, concrete and past-tense. */
  what: string;
  /** Who is involved, by the names used above. */
  who?: string[];
  /**
   * The kind of turn this is, in structure-neutral terms — deliberately not
   * the vocabulary of any one model, so the judging pass isn't led into
   * force-mapping. A "departure" may or may not be a threshold crossing.
   */
  kind?: DigestEventKind;
  /** Whether the section presents this as a large turn or a small one. */
  weight?: "minor" | "notable" | "major";
}

/**
 * Structure-neutral by design. If the walker were allowed to emit "midpoint"
 * or "all is lost", every book would fit every model — principle 2 of the
 * structure document is precisely the warning against that.
 */
export type DigestEventKind =
  | "disruption"
  | "decision"
  | "departure"
  | "arrival"
  | "conflict"
  | "revelation"
  | "reversal"
  | "loss"
  | "gain"
  | "reconciliation"
  | "death"
  | "other";

/** One section's reading, as stored. */
export interface SectionDigest {
  characters: DigestCharacter[];
  events: DigestEvent[];
  /** One or two sentences: what this section is, for the reduce pass. */
  summary?: string;
}

/**
 * A section's digest with its place in the finished book.
 *
 * Position is computed when the digest is read, never stored: it is a fraction
 * of a whole that shifts whenever any other section changes length, and a
 * stored percentage would be wrong the moment the writer added a paragraph
 * anywhere earlier. Since five of the seven structure models make proportional
 * claims, a stale percentage is not a cosmetic problem.
 */
export interface PlacedDigest extends SectionDigest {
  blockId: string;
  label: string | null;
  /** Where this section starts and ends, as a fraction of the whole, 0–1. */
  start: number;
  end: number;
  words: number;
}

/** How far along the walk is, for a work. */
export interface DigestProgress {
  status: "idle" | "walking" | "failed" | "stopped";
  /** Sections whose digest matches their current prose and current model. */
  done: number;
  /** Sections that need reading at all. */
  total: number;
  lastError: string | null;
  /** Null until at least one section has been read and timed. */
  etaSeconds: number | null;
  /** Nothing can be judged until this is true. */
  ready: boolean;
}

/* ---------------------------------------------------------------------- */
/* Findings                                                               */
/* ---------------------------------------------------------------------- */

/**
 * How well the book fits one structure model.
 *
 * Four bands rather than the reference document's three, because a gauge with
 * three stops is barely a gauge — "weak" is split by whether the story's shape
 * actively contradicts the model or merely fails to evidence it.
 *
 * `na` is not a low score and must not render as one. Fifteen timed beats
 * cannot be asked of a three-thousand-word story, and a near-empty bar would
 * read as an accusation the model never made.
 */
export type FitRating = "good" | "moderate" | "low" | "bad" | "na";

export interface FitEvidence {
  /** Which of the model's distinctive elements this instantiates. */
  element: string;
  /** The story event that does it. */
  event: string;
  /** Where, as a percentage of the book, when the finding is positional. */
  position?: number;
}

export interface ModelFit {
  model: string;
  fit: FitRating;
  evidence: FitEvidence[];
  /** Distinctive elements absent or mislocated — why it isn't a better fit. */
  gaps: string[];
  /** The per-framework report: a few sentences of prose. */
  summary: string;
}

export interface StructureAnalysis {
  models: ModelFit[];
  /** Which single model fits most specifically, or null for none of them. */
  bestFit: string | null;
  bestFitWhy: string;
  /** The overall reading, including "this fits no beat model well". */
  overview: string;
}

/** One axis of one character's profile. */
export interface AxisScore {
  axis: string;
  /** 0–5. */
  score: number;
  /** What most supports the score — the citable events the rubric demands. */
  aligned: string[];
  /** What cuts against it: actions that contradict or complicate the reading. */
  contradictory: string[];
}

export interface CharacterAnalysis {
  name: string;
  /** Whose arc the axes are relative to. One chart, one perspective. */
  focal: string;
  axes: AxisScore[];
  /**
   * A line for the tile: how the book would introduce them, or something they
   * might actually say. Drawn from the manuscript, not invented around a name.
   */
  epithet: string;
  /** The report: a reading of the shape, in prose. */
  summary: string;
  /** Role flips and axes concentrated in one span, kept out of the average. */
  phaseShifts: string[];
  /** Where the evidence is thin and which scores are least certain. */
  confidence: string;
}

/**
 * Somebody the walk found.
 *
 * Characters below the evidence threshold are listed but not analysed. Running
 * a model over three mentions cannot produce anything the rubric would accept —
 * every axis would land at 0 or 1 for want of citable events — so it is time
 * and electricity spent to reach a foregone conclusion. They are reported
 * rather than hidden, because "the book barely shows this person" is itself
 * worth seeing.
 */
export interface RosterEntry {
  name: string;
  aliases: string[];
  /** How many sections they appear in. */
  sections: number;
  /** How many recorded actions across the book. */
  actions: number;
  /** Where they appear, as fractions of the book. */
  span: { first: number; last: number };
  /** False when there is too little to judge. */
  judgeable: boolean;
  /** Said plainly when not judgeable. */
  reason?: string;
}

/**
 * How far the manuscript has moved since a report was written.
 *
 * A count rather than a flag, because "no longer current" covers both a fixed
 * typo and three new chapters, and only one of those is a reason to spend
 * twenty minutes running the analysis again.
 */
export interface AnalysisDrift {
  /** Words in sections that were added, cut, or rewritten since the run. */
  words: number;
  /** Those words as a share of the manuscript now. 0–1. */
  fraction: number;
  /** How many sections differ. */
  sections: number;
  /** Null when the report predates snapshots and only the flag is available. */
  measurable: boolean;
}

/** How a queued run of character profiles is getting on. */
export interface CharacterRunProgress {
  status: "queued" | "running" | "idle" | "failed";
  /** Profiles written so far this run. */
  done: number;
  /** How many were asked for. */
  total: number;
  /** Who is being profiled right now, if anyone. */
  current: string | null;
  /** Still to come, in order. */
  remaining: string[];
  lastError: string | null;
  /** Rough seconds left, from what this run has actually cost. Null early on. */
  etaSeconds: number | null;
}

/** Whether the story-shape analysis is under way. */
export interface StructureRunProgress {
  status: "queued" | "running" | "idle" | "failed";
  lastError: string | null;
  /** Seconds it has been going, so a long wait can say so. */
  elapsedSeconds: number | null;
}

/** One recorded action, and where it should go instead. */
export interface ReassignMove {
  /** Which section it was recorded in, so the rewrite lands in the right place. */
  blockId: string;
  /** The action as the digest recorded it. */
  action: string;
  /** The character it belongs to, or null to drop it as belonging to nobody. */
  to: string | null;
  /** Why, in a few words — the writer is approving this, so it has to argue. */
  why: string;
}

/** What the model proposes doing with a ruled-out entry's record. */
export interface ReassignProposal {
  /** The entry being ruled out. */
  name: string;
  /** Why it reads as a non-character. */
  reason: string;
  moves: ReassignMove[];
  /** Distinct characters that would gain something, and so need re-profiling. */
  affected: string[];
}

/** Names the reading gave to one person, and what to call them. */
export interface IdentityGroup {
  canonical: string;
  /** Every name to fold in, canonical included. */
  names: string[];
  why: string;
}

/** A name whose record reads like more than one person. */
export interface IdentitySuspect {
  name: string;
  why: string;
}

/** What a reconciliation pass proposes doing to the cast. */
export interface IdentityProposal {
  groups: IdentityGroup[];
  suspects: IdentitySuspect[];
}

/**
 * Words that only ever count or point, and never identify.
 *
 * A digest naming the same people twice is the commonest way the roster grows a
 * duplicate: one section writes "Two French brothers", the next writes "French
 * brothers", and they arrive as two characters with half a record each. Folding
 * these off the front settles it.
 *
 * Deliberately short, and deliberately not including honorifics. Dropping "Mr"
 * would fold Mr Bennet and Mrs Bennet into one person, which is a far worse
 * error than the one being fixed — a duplicate is untidy, a merge is wrong.
 */
const LEADING_NOISE = new Set([
  "a",
  "an",
  "the",
  "some",
  "several",
  "many",
  "few",
  "both",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "another",
  "other",
  "various",
  "assorted",
  "unnamed",
  "unknown",
]);

/**
 * The key two spellings of one name have in common.
 *
 * Lowercased, stripped of punctuation, and with counting words taken off the
 * front. Conservative on purpose: it merges what is plainly the same phrase and
 * leaves anything else alone.
 */
export function foldName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.,''"()\[\]]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  let start = 0;
  while (start < words.length - 1 && LEADING_NOISE.has(words[start]!)) start += 1;

  return words.slice(start).join(" ");
}

/**
 * Titles that sit in front of a name.
 *
 * These cannot be stripped blindly. "Mr Bennet" and "Mrs Bennet" fold to the
 * same thing and are two people, and merging them corrupts both profiles — far
 * worse than leaving a duplicate. So they are stripped only where the roster
 * itself shows it is safe: see `mergeTitled`.
 */
const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "master",
  "sir",
  "lady",
  "lord",
  "dame",
  "dr",
  "doctor",
  "prof",
  "professor",
  "rev",
  "reverend",
  "father",
  "mother",
  "brother",
  "sister",
  "saint",
  "st",
  "captain",
  "capt",
  "colonel",
  "col",
  "major",
  "general",
  "lieutenant",
  "lt",
  "sergeant",
  "sgt",
  "admiral",
  "king",
  "queen",
  "prince",
  "princess",
  "duke",
  "duchess",
  "count",
  "countess",
  "baron",
  "uncle",
  "aunt",
  "cousin",
  "old",
  "young",
]);

/** The name with any leading title removed, or null if there wasn't one. */
export function withoutTitle(folded: string): string | null {
  const words = folded.split(" ");
  if (words.length < 2 || !TITLES.has(words[0]!)) return null;
  return words.slice(1).join(" ");
}

/**
 * Fold "Brother Tuan" into "Tuan" — but only when that is demonstrably safe.
 *
 * The test is the roster itself. If exactly one titled form reduces to a given
 * bare name, the two are the same person and are merged. If two do — Mr Bennet
 * and Mrs Bennet both reducing to "bennet" — the title is the only thing
 * telling them apart, so nothing is touched.
 *
 * This is why it runs after the roster is built rather than inside the fold: it
 * is a question about the cast, and a string on its own cannot answer it.
 */
export function mergeTitled(byKey: Map<string, RosterEntry>): void {
  const reducesTo = new Map<string, string[]>();
  for (const key of byKey.keys()) {
    const bare = withoutTitle(key);
    if (!bare) continue;
    reducesTo.set(bare, [...(reducesTo.get(bare) ?? []), key]);
  }

  for (const [bare, titled] of reducesTo) {
    // Only when the bare name is itself in the cast, and only one title claims
    // it. Two claimants means the title is load-bearing.
    if (titled.length !== 1) continue;
    const host = byKey.get(bare);
    const held = byKey.get(titled[0]!);
    if (!host || !held) continue;

    host.sections += held.sections;
    host.actions += held.actions;
    host.span.first = Math.min(host.span.first, held.span.first);
    host.span.last = Math.max(host.span.last, held.span.last);
    for (const alias of [held.name, ...held.aliases]) {
      if (!host.aliases.includes(alias) && alias !== host.name) host.aliases.push(alias);
    }
    byKey.delete(titled[0]!);
  }
}

